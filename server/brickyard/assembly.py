"""Revision-bound assembly plans: exact coverage, connections and insertion paths.

This is a conservative rigid-translation proof for supported stud connections,
not a strength, clutch-force, hand-access or flexible-joint certification.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections import Counter, defaultdict
from itertools import product
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from brickyard.assembly_geometry import Envelope, envelopes, rigid_grid, swept_interval
from brickyard.connectors import EPS, POLICY, ConnectorError, GeometryChangedError, Library, Port, Vec, compatible, dot
from brickyard.model import Build

PLAN_VERSION = 1
LIMITS = [
    "Supported rigid stud/socket connections and straight insertion only.",
    "Conservative full-mesh envelopes can reject feasible assemblies with cavities.",
    "Clutch force, strength, hand clearance and unsupported joints are not certified.",
]


class Operation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    part: int | None = None
    assembly: str | None = None
    approach: Vec | None = None
    """From the final placement towards the outside; insertion follows -approach."""

    @model_validator(mode="after")
    def one_target(self):
        if (self.part is None) == (self.assembly is None):
            raise ValueError("Introduce exactly one part or one child assembly")
        return self


class Group(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    operations: list[Operation] = Field(min_length=1, max_length=20000)


class Plan(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = PLAN_VERSION
    revision: str
    policy: str = POLICY
    root: str = "model"
    groups: list[Group] = Field(min_length=1, max_length=20000)
    evidence: str | None = None


class Issue(BaseModel):
    code: str
    message: str
    moving: list[int] = []
    obstacles: list[int] = []
    group: str | None = None
    operation: int | None = None


class AssemblyError(ValueError):
    def __init__(self, issue: Issue):
        self.issue = issue
        super().__init__(issue.message)


def reject(code: str, message: str, **details):
    raise AssemblyError(Issue(code=code, message=message, **details))


class Report(BaseModel):
    revision: str
    status: Literal["verified", "unverified"]
    policy: str = POLICY
    pieces: int
    evidence: str | None = None
    plan: Plan | None = None
    issues: list[Issue] = []
    limitations: list[str] = LIMITS


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def topology(build: Build, plan: Plan) -> tuple[list[Group], dict[str, set[int]]]:
    """Validate the assembly tree before geometry; leaf IDs are the only BOM source."""
    if plan.revision != build.revision or plan.policy != POLICY:
        reject("stale_plan", "The model or assembly policy changed; regenerate the plan.")
    ids = [p.id for p in build.pieces]
    if not ids or len(ids) != len(set(ids)):
        reject("invalid_model", "A model needs nonempty, unique physical part instance IDs.")
    groups = {g.id: g for g in plan.groups}
    if len(groups) != len(plan.groups) or plan.root not in groups:
        reject("invalid_tree", "Assembly IDs must be unique and include the root.")
    leaves, children = Counter(), Counter()
    visiting, seen, order, members = set(), set(), [], {}

    def visit(name, depth=0):
        if name not in groups or name in visiting or depth > 64:
            reject("invalid_tree", "Missing, cyclic or excessively nested subassembly.")
        if name in seen:
            reject("duplicate_assembly", "A physical subassembly cannot be attached twice.")
        visiting.add(name)
        parts = set()
        for op in groups[name].operations:
            if op.part is not None:
                leaves[op.part] += 1
                parts.add(op.part)
            else:
                children[op.assembly] += 1
                parts.update(visit(op.assembly, depth + 1))
        visiting.remove(name)
        seen.add(name)
        members[name] = parts
        order.append(groups[name])
        return parts

    visit(plan.root)
    if seen != set(groups):
        reject("unused_assembly", "Every subassembly must contribute to the final model.")
    missing, extra = set(ids) - set(leaves), set(leaves) - set(ids)
    duplicates = sorted(k for k, v in leaves.items() if v != 1)
    if missing or extra or duplicates:
        reject(
            "coverage",
            f"Every part must appear exactly once. Missing {sorted(missing)[:20]}, extra {sorted(extra)[:20]}, repeated {duplicates[:20]}.",
        )
    return order, members


class Checker:
    def __init__(self, build: Build, library: Library | None = None, budget: int = 500_000):
        self.build = build
        self.library = library or Library()
        self.parts = {p.id: p for p in build.pieces}
        if len(self.parts) > 20000:
            reject("planning_limit", "Automatic assembly checking currently supports at most 20000 parts.")
        self.local = {p.id: self.library.profile(p.part) for p in build.pieces}
        self.library.verify_geometry()
        self.world = {p.id: self.library.world(p) for p in build.pieces}
        for p in build.pieces:
            if not rigid_grid(p):
                reject(
                    "unsupported_orientation",
                    "Insertion proof currently supports orthogonal rigid part orientations only.",
                    moving=[p.id],
                )
        self.boxes = {p.id: envelopes(p, self.local[p.id].ports) for p in build.pieces}
        self.coarse = {
            i: Envelope(
                tuple(min(b.lo[k] for b in boxes) for k in range(3)),
                tuple(max(b.hi[k] for b in boxes) for k in range(3)),
            )
            for i, boxes in self.boxes.items()
        }
        self.graph = {p.id: set() for p in build.pieces}
        self.mates: dict[tuple[int, int], list[tuple[Port, Port]]] = defaultdict(list)
        locations = defaultdict(list)
        for p in build.pieces:
            for port in self.world[p.id].ports:
                key = tuple(int(x // EPS) for x in port.pos)
                for off in product([-1, 0, 1], repeat=3):
                    for other, q in locations[tuple(k + d for k, d in zip(key, off, strict=True))]:
                        if other != p.id and compatible(port, q):
                            self.graph[p.id].add(other)
                            self.graph[other].add(p.id)
                            self.mates[p.id, other].append((port, q))
                            self.mates[other, p.id].append((q, port))
                locations[key].append((p.id, port))
        # Geometry, connector data and schema are frozen along with exact positions.
        self.evidence = digest([POLICY, build.revision, sorted((i, p.fingerprint) for i, p in self.local.items())])
        self.budget = budget
        self.pair_cache = {}

    def connected(self, ids: set[int]) -> bool:
        if not ids:
            return False
        seen, queue = set(), [min(ids)]
        while queue:
            p = queue.pop()
            if p not in seen:
                seen.add(p)
                queue.extend((self.graph[p] & ids) - seen)
        return seen == ids

    def contacts(self, moving: set[int], fixed: set[int]):
        return [
            (a, b, p, q) for a in sorted(moving) for b in sorted(self.graph[a] & fixed) for p, q in self.mates[a, b]
        ]

    def pair_blocked(self, a: int, b: int, direction: Vec) -> bool:
        # Reject irrelevant pairs cheaply before spending search budget on detailed envelopes.
        if swept_interval(self.coarse[a], self.coarse[b], direction) is None:
            return False
        key = (a, b, direction)
        if key in self.pair_cache:
            return self.pair_cache[key]
        self.budget -= 1
        if self.budget < 0:
            reject(
                "planning_limit", "Insertion search budget exhausted; propose a subassembly plan or simplify the model."
            )
        mates = self.mates.get((a, b), [])
        blocked = False
        for moving in self.boxes[a]:
            for fixed in self.boxes[b]:
                interval = swept_interval(moving, fixed, direction)
                if interval is None:
                    continue
                # The sole admitted penetration is a metadata-matched stud cap
                # withdrawing from its socket, fully clear within 4 LDU.
                allowed = interval[1] <= 4 + EPS and any(
                    (moving.stud == p and fixed.stud is None and q.gender == "F" and dot(direction, p.axis) < -1 + 1e-6)
                    or (
                        fixed.stud == q
                        and moving.stud is None
                        and p.gender == "F"
                        and dot(direction, q.axis) > 1 - 1e-6
                    )
                    for p, q in mates
                )
                if not allowed:
                    blocked = True
                    break
            if blocked:
                break
        self.pair_cache[key] = blocked
        return blocked

    def approach(self, moving: set[int], fixed: set[int], requested: Vec | None = None) -> Vec:
        contacts = self.contacts(moving, fixed)
        if not contacts:
            reject(
                "unconnected",
                "No supported stud/socket connection joins the new unit to the previous step. Mere touching is insufficient; unsupported joints require another validated policy.",
                moving=sorted(moving)[:30],
                obstacles=sorted(fixed)[:30],
            )
        directions = [tuple(v * (1 if p.gender == "F" else -1) for v in p.axis) for _, _, p, _ in contacts]
        direction = directions[0]
        if any(dot(direction, d) < 1 - 1e-6 for d in directions) or (
            requested is not None and any(abs(a - b) > 1e-6 for a, b in zip(direction, requested, strict=True))
        ):
            reject(
                "incompatible_insertions",
                "These connections cannot engage along one straight insertion. Build a subassembly first or change the connection layout.",
                moving=sorted(moving)[:30],
            )
        for a in sorted(moving):
            for b in sorted(fixed):
                if self.pair_blocked(a, b, direction):
                    reject(
                        "blocked_insertion",
                        "The insertion corridor intersects a previously placed part. Reorder the steps, prepare a subassembly, or change the geometry.",
                        moving=[a],
                        obstacles=[b],
                    )
        return direction

    def validate(self, plan: Plan) -> Plan:
        order, members = topology(self.build, plan)
        if plan.evidence is not None and plan.evidence != self.evidence:
            reject("stale_evidence", "Connector or geometry data changed; regenerate the plan.")
        result = plan.model_copy(deep=True)
        byid = {g.id: g for g in result.groups}
        for group in order:
            placed = set()
            for n, op in enumerate(byid[group.id].operations):
                incoming = {op.part} if op.part is not None else members[op.assembly]
                try:
                    if placed:
                        op.approach = self.approach(incoming, placed, op.approach)
                    elif op.approach is not None:
                        reject("seed_direction", "The first unit rests on the work surface; it has no insertion arrow.")
                except AssemblyError as exc:
                    exc.issue.group, exc.issue.operation = group.id, n + 1
                    raise
                placed.update(incoming)
        result.evidence = self.evidence
        return result

    def auto(self) -> Plan:
        ids = set(self.parts)
        if not ids:
            reject("empty_model", "Build a model before planning assembly.")
        if not self.connected(ids):
            islands = []
            unseen = set(ids)
            while unseen:
                component, queue = set(), [min(unseen)]
                while queue:
                    p = queue.pop()
                    if p not in component:
                        component.add(p)
                        queue.extend((self.graph[p] & unseen) - component)
                unseen -= component
                islands.append(component)
            islands.sort(key=lambda group: (-len(group), min(group)))
            examples = [f"#{min(group)} ({self.parts[min(group)].part}, {len(group)} parts)" for group in islands[:12]]
            reject(
                "disconnected_model",
                f"The supported connection graph has {len(islands)} separate islands: "
                + "; ".join(examples)
                + ". Join them with verified connectors. Bare ground is not a LEGO connection. "
                "Intentionally separate display objects cannot be verified as one connected assembly by this policy.",
                moving=sorted(islands[1])[:30],
                obstacles=[min(islands[0])],
            )
        groups = []
        last_issue = None

        def solve(parts: set[int], name: str, depth=0):
            nonlocal last_issue
            if depth > 60:
                reject("planning_limit", "Subassembly nesting limit reached.")
            remaining, removed = set(parts), []
            while len(remaining) > 1:
                found = False
                # High parts first tends to produce intuitive bottom-up manuals.
                for part in sorted(remaining, key=lambda i: (self.parts[i].pos[1], i)):
                    rest = remaining - {part}
                    if not self.connected(rest):
                        continue
                    try:
                        direction = self.approach({part}, rest)
                    except AssemblyError as exc:
                        if exc.issue.code == "planning_limit":
                            raise
                        last_issue = exc.issue
                        continue
                    removed.append(Operation(part=part, approach=direction))
                    remaining = rest
                    found = True
                    break
                if not found:
                    break
            if len(remaining) == 1:
                ops = [Operation(part=min(remaining))]
            else:
                # Connected cuts around articulation points expose useful rigid
                # groups. Explicit proposals can express other partitions.
                split = None
                for pivot in sorted(remaining):
                    unseen = remaining - {pivot}
                    while unseen:
                        component, queue = set(), [min(unseen)]
                        while queue:
                            p = queue.pop()
                            if p not in component:
                                component.add(p)
                                queue.extend((self.graph[p] & unseen) - component)
                        unseen -= component
                        other = remaining - component
                        if len(component) < 2 or not self.connected(other):
                            continue
                        try:
                            direction = self.approach(component, other)
                        except AssemblyError as exc:
                            if exc.issue.code == "planning_limit":
                                raise
                            last_issue = exc.issue
                            continue
                        split = (component, other, direction)
                        break
                    if split:
                        break
                if split is None:
                    if last_issue:
                        raise AssemblyError(last_issue)
                    reject("no_plan", "No supported insertion order found; propose explicit subassemblies.")
                moving, fixed, direction = split
                solve(fixed, name + "-base", depth + 1)
                solve(moving, name + "-unit", depth + 1)
                ops = [Operation(assembly=name + "-base"), Operation(assembly=name + "-unit", approach=direction)]
            groups.append(
                Group(
                    id=name,
                    title="Main assembly" if name == "model" else f"Subassembly {len(groups) + 1}",
                    operations=[*ops, *reversed(removed)],
                )
            )

        solve(ids, "model")
        return self.validate(Plan(revision=self.build.revision, groups=groups))


def check(build: Build, plan: Plan | None = None, library: Library | None = None) -> Report:
    """Public fail-closed result; malformed geometry/data cannot yield a manual."""
    try:
        if plan:
            topology(build, plan)
        checker = Checker(build, library)
        verified = checker.validate(plan) if plan else checker.auto()
        return Report(
            revision=build.revision,
            status="verified",
            pieces=len(build.pieces),
            evidence=checker.evidence,
            plan=verified,
        )
    except AssemblyError as exc:
        return Report(revision=build.revision, status="unverified", pieces=len(build.pieces), issues=[exc.issue])
    except GeometryChangedError as exc:
        return Report(
            revision=build.revision,
            status="unverified",
            pieces=len(build.pieces),
            issues=[Issue(code="geometry_changed", message=str(exc))],
        )
    except (ConnectorError, KeyError, OSError, ValueError, IndexError, RecursionError) as exc:
        return Report(
            revision=build.revision,
            status="unverified",
            pieces=len(build.pieces),
            issues=[
                Issue(
                    code="data_unavailable",
                    message=f"Assembly data unavailable ({type(exc).__name__}); check the installed LDraw and connector libraries.",
                )
            ],
        )


def describe(report: Report) -> str:
    if report.status == "verified":
        return f"Assembly plan verified for revision {report.revision}: {report.pieces} parts exactly once; {len(report.plan.groups)} assembly sections. Supported stud connections and insertion corridors checked. Strength and hand access require physical validation."
    return "Assembly NOT verified.\n" + "\n".join(
        f"{i.code}: {i.message} Moving {i.moving}; obstacles {i.obstacles}; section {i.group}, operation {i.operation}."
        for i in report.issues
    )


def cached_plan(folder: Path, build: Build) -> Plan | None:
    path = folder / "assembly-plan.json"
    if path.exists():
        try:
            plan = Plan.model_validate_json(path.read_text())
            # Recheck the saved order against today's data rather than keeping
            # an old proof forever. Explicit proposals/downloads retain their
            # evidence and reject changes; only this cache read renews it.
            return (
                plan.model_copy(update={"evidence": None})
                if plan.revision == build.revision and plan.policy == POLICY
                else None
            )
        except ValueError:
            pass
    return None


def save_report(folder: Path, report: Report) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    if report.plan:
        target = folder / "assembly-plan.json"
        temp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        temp.write_text(report.plan.model_dump_json(indent=2))
        temp.replace(target)
    target = folder / "assembly-report.json"
    temp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    temp.write_text(report.model_dump_json(indent=2))
    temp.replace(target)
