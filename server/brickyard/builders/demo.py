"""Scripted builder that exercises the shell: always builds the same cottage, one step at a time."""

from __future__ import annotations

import asyncio

from brickyard.model import Placement, attach, place
from brickyard.session import Session

GREEN, WHITE, TAN, RED, DARK_RED, YELLOW = 2, 15, 19, 4, 320, 14
BROWN, LIGHT_GRAY, DARK_GRAY, DARK_GREEN, CLEAR = 70, 71, 72, 288, 47
BRICKS = {4: "3010.dat", 3: "3622.dat", 2: "3004.dat", 1: "3005.dat"}
X0, Y0, X1, Y1 = 8, 10, 23, 21
DOOR = range(15, 17)
WINDOWS_FRONT_BACK = (10, 20)
WINDOWS_SIDES = (14,)


def runs(cells: list[int]) -> list[tuple[int, int]]:
    """Contiguous (start, length) runs in a sorted list of stud indices."""
    out: list[tuple[int, int]] = []
    for c in cells:
        if out and out[-1][0] + out[-1][1] == c:
            out[-1] = (out[-1][0], out[-1][1] + 1)
        else:
            out.append((c, 1))
    return out


def lengths(n: int, stagger: bool) -> list[int]:
    """Brick lengths covering n studs, starting with a short brick on staggered courses so joints alternate."""
    out = [2] if stagger and n > 2 else []
    left = n - sum(out)
    while left:
        out.append(min(4, left))
        left -= out[-1]
    return out


def wall_course(z: int, color: int, openings: set[tuple[int, int]]) -> list[Placement]:
    course = z // 3
    even = course % 2 == 0
    pieces = []
    for y in (Y0, Y1):
        xs = [x for x in range(X0 if even else X0 + 1, (X1 if even else X1 - 1) + 1) if (x, y) not in openings]
        for start, n in runs(xs):
            x = start
            for length in lengths(n, stagger=not even):
                pieces.append(place(BRICKS[length], x, y, z, color))
                x += length
    for x in (X0, X1):
        ys = [y for y in range((Y0 + 1) if even else Y0, ((Y1 - 1) if even else Y1) + 1) if (x, y) not in openings]
        for start, n in runs(ys):
            y = start
            for length in lengths(n, stagger=even):
                pieces.append(place(BRICKS[length], x, y, z, color, rotation=90))
                y += length
    return pieces


def openings_at(z: int) -> set[tuple[int, int]]:
    cells = set()
    if z < 12:
        cells |= {(x, Y0) for x in DOOR}
    if 3 <= z < 9:
        for x in WINDOWS_FRONT_BACK:
            cells |= {(x, Y0), (x + 1, Y0), (x, Y1), (x + 1, Y1)}
        for y in WINDOWS_SIDES:
            cells |= {(X0, y), (X0, y + 1), (X1, y), (X1, y + 1)}
    if z == 12:
        cells |= {(x, Y0) for x in range(DOOR.start - 1, DOOR.stop + 1)}
    return cells


class DemoBuilder:
    name = "demo"

    def __init__(self, delay: float = 0.35):
        self.delay = delay

    async def _step(self, session: Session, title: str, pieces: list[Placement]) -> None:
        await session.step(title, pieces)
        await asyncio.sleep(self.delay)

    async def run(self, session: Session, request: str) -> None:
        if session.build.pieces:
            await session.say("The demo builder only knows one cottage, and it is already built.")
            return
        await session.rename("Garden Cottage")
        await session.say(
            "Scripted demo builder: I always build the same cottage, so you can see the shell work end to end. "
            "Starting with a 32x32 baseplate."
        )
        baseplate = place("3811.dat", 0, 0, 0, GREEN)
        await self._step(session, "Baseplate", [baseplate.model_copy(update={"pos": (320.0, 0.0, 320.0)})])
        path = [place("3068b.dat", DOOR.start, y, 0, LIGHT_GRAY) for y in range(2, Y0, 2)]
        await self._step(session, "Stone path to the door", path)

        await session.say("Walls: bonded courses, joints staggered course to course, openings for door and windows.")
        for z in range(0, 18, 3):
            color = DARK_GRAY if z == 0 else WHITE
            await self._step(session, f"Wall course {z // 3 + 1}", wall_course(z, color, openings_at(z)))
            if z == 3:
                windows = []
                for x in WINDOWS_FRONT_BACK:
                    for y in (Y0, Y1):
                        frame = place("60592.dat", x, y, 3, WHITE)
                        windows += [frame, attach(frame, "60601.dat", CLEAR)]
                for x in (X0, X1):
                    for y in WINDOWS_SIDES:
                        frame = place("60592.dat", x, y, 3, WHITE, rotation=90)
                        windows += [frame, attach(frame, "60601.dat", CLEAR)]
                await self._step(session, "Windows", windows)
            if z == 9:
                await self._step(session, "Door arch", [place("3659.dat", DOOR.start - 1, Y0, 12, BROWN)])

        await session.say("Roof: a plate deck, then 45 degree slopes stepping in two studs per course.")
        deck = [place("3020.dat", x, y, 18, WHITE) for x in range(X0, X1 + 1, 4) for y in range(Y0, Y1 + 1, 2)]
        await self._step(session, "Roof deck", deck)
        z = 19
        for k in range(3):
            front, back = Y0 + 2 * k, Y1 - 1 - 2 * k
            roof = []
            for x in range(X0, X1 + 1, 4):
                roof.append(place("3037.dat", x, front, z, DARK_RED))
                roof.append(place("3037.dat", x, back, z, DARK_RED, rotation=180))
                roof += [place("3001.dat", x, y, z, WHITE) for y in range(front + 2, back, 2)]
            await self._step(session, f"Roof course {k + 1}", roof)
            z += 3
        ridge = [place("3043.dat", x, Y0 + 5, z, DARK_RED) for x in range(X0, X1 + 1, 2)]
        await self._step(session, "Ridge", ridge)

        await session.say("Garden: trees in the corners, flower beds by the door, a fence along the front.")
        trees = [
            place("3471.dat", 1, 1, 0, DARK_GREEN),
            place("3471.dat", 26, 3, 0, DARK_GREEN),
            place("3470.dat", 2, 25, 0, GREEN),
            place("3470.dat", 26, 25, 0, GREEN),
        ]
        await self._step(session, "Trees", trees)
        flowers = [place("3742.dat", x, Y0 - 2, 0, RED if x % 2 else YELLOW) for x in [*range(9, 14), *range(18, 23)]]
        await self._step(session, "Flower beds", flowers)
        fence = [place("3633.dat", x, 0, 0, BROWN) for x in [*range(0, 12, 4), *range(20, 32, 4)]]
        await self._step(session, "Fence", fence)
        await session.say(f"Done: {len(session.build.pieces)} pieces in {len(session.build.steps)} steps.")


BUILDERS = {"demo": DemoBuilder()}
