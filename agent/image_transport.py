"""Bound the final multimodal request without deleting archived visual evidence."""

from __future__ import annotations

import hashlib
import logging
import math

from hai_adapters.llm import LanguageModel
from hai_protocols.base import NOT_GIVEN
from hai_protocols.chat_completion.messages import ImageContentChunk, TextContentChunk
from hai_protocols.image.encoding import MediaType
from hai_protocols.image.source import Base64ImageSource
from PIL import Image, ImageDraw, ImageFont, ImageOps

LOGGER = logging.getLogger(__name__)


def contact_sheet(images: list[tuple[int, ImageContentChunk]]) -> ImageContentChunk:
    """Keep every view visible with a number matching its original position in the conversation.

    These are overview panels, not replacements for archived originals or requested detail crops.
    PNG keeps the packing deterministic and does not introduce lossy compression artifacts.
    """
    columns = 2
    tile = 960
    heading = 40
    rows = math.ceil(len(images) / columns)
    sheet = Image.new("RGB", (columns * tile, rows * (tile + heading)), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=24)
    for i, (number, chunk) in enumerate(images):
        with chunk.load() as original:
            panel = ImageOps.contain(ImageOps.exif_transpose(original), (tile, tile))
            x = (i % columns) * tile
            y = (i // columns) * (tile + heading)
            draw.text((x + 12, y + 8), f"Image {number}", font=font, fill="black")
            sheet.paste(panel, (x + (tile - panel.width) // 2, y + heading + (tile - panel.height) // 2))
    return ImageContentChunk(source=Base64ImageSource.from_image(sheet, MediaType.PNG))


def bounded_images(request, limit: int):
    """Apply one budget across messages and tools, after all callbacks/compaction have run.

    Under-budget prompts are untouched. On overflow, identical bytes share one attachment; if
    needed, middle views are packed while the first reference and newest inspection stay separate.
    No image is silently evicted and no conversation or library object is mutated.
    """
    positions = [
        (mi, ci, chunk)
        for mi, message in enumerate(request.messages)
        if isinstance(message.content, (list, tuple))
        for ci, chunk in enumerate(message.content)
        if isinstance(chunk, ImageContentChunk)
    ]
    if len(positions) <= limit:
        return request

    unique = {}
    numbers = {}
    for mi, ci, chunk in positions:
        key = hashlib.sha256(chunk.source.to_url().encode()).digest()
        if key not in unique:
            unique[key] = (len(unique) + 1, chunk)
        numbers[mi, ci] = unique[key][0]
    views = list(unique.values())
    attachments = {number: chunk for number, chunk in views}
    packed = set()
    if len(views) > limit:
        # The first image usually anchors subject identity; the last is the newest render/detail.
        # Balance middle views across the remaining slots to avoid one unreadably large mosaic.
        middle = views[1:-1]
        slots = limit - 2
        for slot in range(slots):
            group = middle[slot * len(middle) // slots : (slot + 1) * len(middle) // slots]
            if len(group) == 1:
                continue
            for number, _ in group:
                del attachments[number]
                packed.add(number)
            attachments[group[-1][0]] = contact_sheet(group)

    attached = set()
    messages = []
    for mi, message in enumerate(request.messages):
        if not isinstance(message.content, (list, tuple)):
            messages.append(message)
            continue
        content = []
        for ci, chunk in enumerate(message.content):
            number = numbers.get((mi, ci))
            if number is None:
                content.append(chunk)
                continue
            if number in packed:
                label = (
                    f"Image {number}: see its numbered panel in the overview sheets. "
                    "Panels may reduce detail; reopen the saved image or request a reference/model inspection "
                    "for fine features. Do not treat unreadable detail as verified."
                )
            else:
                label = f"Image {number}" + (" (same pixels as the earlier attachment)." if number in attached else ":")
            content.append(TextContentChunk(text=label))
            if number in attachments and number not in attached:
                content.append(attachments[number])
            attached.add(number)
        messages.append(message.model_copy(update={"content": content}))
    LOGGER.info(
        "Image transport: %d image occurrences, %d unique views, %d attachments; packed panels=%s",
        len(positions),
        len(views),
        len(attachments),
        sorted(packed),
    )
    return request.model_copy(update={"messages": messages})


class ImageBoundedLanguageModel(LanguageModel):
    """Use the same outgoing-image contract for the builder, reviewer and compactor."""

    def __init__(self, *, max_request_images: int = 5, **kwargs):
        super().__init__(**kwargs)
        self.max_request_images = int(max_request_images)
        if self.max_request_images < 3:
            raise ValueError("max_request_images must leave room for a reference, overview and latest image (>=3)")

    def chat(self, request, timeout=NOT_GIVEN):
        if isinstance(request, list):
            request = [bounded_images(r, self.max_request_images) for r in request]
        else:
            request = bounded_images(request, self.max_request_images)
        return super().chat(request, timeout=timeout)
