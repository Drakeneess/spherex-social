"""Non-destructive astronomical display recipes.

This module maps floating point FITS reprojections into display-only RGB PNGs.
No transformation changes the archived scientific data. No photometry or
confirmed movement can be inferred from the colored result.
"""
from __future__ import annotations

import base64
import io
import re
from typing import Literal

import numpy as np
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, field_validator

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


class RevealRecipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    palette: Literal["gray", "cyan", "violet", "ember", "custom"] = "cyan"
    stretch: Literal["linear", "asinh", "log"] = "asinh"
    black: float = Field(default=2.0, ge=0, le=20, allow_inf_nan=False)
    white: float = Field(default=99.5, ge=80, le=100, allow_inf_nan=False)
    gamma: float = Field(default=1.0, ge=0.4, le=2.4, allow_inf_nan=False)
    highlight: str = "#62cfff"
    shadow: str = "#080d28"
    format: Literal["square", "portrait", "wide"] = "square"
    sampling: Literal["smooth", "pixels"] = "smooth"

    @field_validator("highlight", "shadow")
    @classmethod
    def valid_color(cls, value: str) -> str:
        if not HEX.fullmatch(value):
            raise ValueError("Color must be #RRGGBB")
        return value.lower()


def _rgb(hex_color: str) -> np.ndarray:
    return np.array([int(hex_color[x:x+2], 16) for x in (1, 3, 5)],
                    dtype=np.float32)


def reveal_png(pixels: np.ndarray, recipe: RevealRecipe) -> str:
    """Small, bounded, faithful display transform of a 2D float image."""
    source = np.asarray(pixels, dtype=np.float32)
    if source.ndim != 2 or not (1 <= source.shape[0] <= 256 and 1 <= source.shape[1] <= 256):
        raise ValueError("Invalid scientific image shape")
    finite = np.isfinite(source)
    values = source[finite]
    if values.size:
        lo, hi = np.percentile(values, [recipe.black, recipe.white])
        if hi <= lo:
            hi = lo + 1.0
        normalized = np.clip((source - lo) / (hi - lo), 0, 1)
        normalized = np.nan_to_num(normalized, nan=0, posinf=1, neginf=0)
    else:
        normalized = np.zeros(source.shape, dtype=np.float32)
    if recipe.stretch == "asinh":
        normalized = np.arcsinh(8.0 * normalized) / np.arcsinh(8.0)
    elif recipe.stretch == "log":
        normalized = np.log1p(100.0 * normalized) / np.log1p(100.0)
    normalized = np.clip(normalized ** (1.0 / recipe.gamma), 0, 1)

    if recipe.palette == "gray":
        dark, mid, bright = _rgb("#000000"), _rgb("#aaaaaa"), _rgb("#ffffff")
    elif recipe.palette == "cyan":
        dark, mid, bright = _rgb("#060a24"), _rgb("#32aeef"), _rgb("#e5faff")
    elif recipe.palette == "violet":
        dark, mid, bright = _rgb("#11091d"), _rgb("#a659e8"), _rgb("#ffd5f9")
    elif recipe.palette == "ember":
        dark, mid, bright = _rgb("#1b060b"), _rgb("#ea563a"), _rgb("#ffe7a2")
    else:
        dark, mid, bright = _rgb(recipe.shadow), _rgb(recipe.highlight), _rgb("#ffffff")
    low = normalized[..., None] * 2
    first = dark + (mid - dark) * np.clip(low, 0, 1)
    second = mid + (bright - mid) * np.clip(low - 1, 0, 1)
    colored = np.where(normalized[..., None] <= 0.5, first, second)
    colored[~finite] = 0
    rgb = np.uint8(np.clip(np.flipud(colored), 0, 255))
    resample = Image.Resampling.BILINEAR if recipe.sampling == "smooth" else Image.Resampling.NEAREST
    image = Image.fromarray(rgb, mode="RGB")
    # Display sampling only; source arrays retain their native resolution.
    image = image.resize((600, 600), resample=resample)
    if recipe.format == "portrait":
        canvas = Image.new("RGB", (600, 750), (3, 5, 13))
        canvas.paste(image, (0, 75))
        image = canvas
    elif recipe.format == "wide":
        canvas = Image.new("RGB", (800, 450), (3, 5, 13))
        image = image.resize((450, 450), resample=resample)
        canvas.paste(image, (175, 0))
        image = canvas
    with io.BytesIO() as out:
        image.save(out, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode("ascii")
