"""Seeded photographic effects and the matching geometric box transformation."""

import io
import math
import random

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageFilter

from .catalogue import Box, CaptureSettings


def sample_capture(rng: random.Random, digits: str) -> CaptureSettings:
    """Sample all capture controls, storing corner offsets as fractions of image size."""
    return {
        "blur_sigma": rng.choice((0, 0.6, 1.0)),
        "glare": {"opacity": round(rng.uniform(0.04, 0.2), 6), "center_x": round(rng.uniform(0.15, 0.85), 6),
                  "center_y": round(rng.uniform(0.15, 0.85), 6), "radius": round(rng.uniform(0.25, 0.55), 6)},
        "rotation_deg": round(rng.uniform(-2, 2), 6),
        "perspective_jitter": [[round(rng.uniform(-0.025, 0.025), 6) for _ in range(2)] for _ in range(4)],
        "jpeg_quality": rng.randint(60, 92), "digits": digits,
    }


def homography(width: int, height: int, capture: CaptureSettings) -> NDArray[np.float64]:
    """Compose corner jitter followed by rotation into the single transform used everywhere."""
    corners = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    offsets = np.asarray(capture["perspective_jitter"], dtype=np.float32) * [width, height]
    perspective = cv2.getPerspectiveTransform(corners, (corners + offsets).astype(np.float32))
    rotation = np.eye(3, dtype=np.float64)
    rotation[:2] = cv2.getRotationMatrix2D(((width - 1) / 2, (height - 1) / 2), capture["rotation_deg"], 1.0)
    return rotation @ perspective


def transform_box(box: Box, matrix: NDArray[np.float64]) -> list[float]:
    """Transform all four text-box corners and retain their enclosing final-image box."""
    x, y, width, height = box
    points = np.array([[x, y, 1], [x + width, y, 1], [x + width, y + height, 1], [x, y + height, 1]], dtype=np.float64)
    projected = points @ matrix.T
    projected = projected[:, :2] / projected[:, 2:]
    low, high = projected.min(axis=0), projected.max(axis=0)
    return [round(float(low[0]), 4), round(float(low[1]), 4),
            round(float(high[0] - low[0]), 4), round(float(high[1] - low[1]), 4)]


def apply_capture(image: Image.Image, capture: CaptureSettings) -> tuple[bytes, NDArray[np.float64]]:
    """Apply blur, radial glare and a shared projective warp before deterministic JPEG encoding."""
    cv2.setNumThreads(1)
    width, height = image.size
    image = image.filter(ImageFilter.GaussianBlur(capture["blur_sigma"]))
    pixels = np.asarray(image, dtype=np.float32)
    glare = capture["glare"]
    yy, xx = np.ogrid[:height, :width]
    distance = ((xx - glare["center_x"] * width) ** 2 + (yy - glare["center_y"] * height) ** 2)
    radius = glare["radius"] * math.hypot(width, height)
    alpha = (glare["opacity"] * np.maximum(0, 1 - np.sqrt(distance) / radius) ** 2)[..., None]
    pixels = np.rint(pixels * (1 - alpha) + 255 * alpha).clip(0, 255).astype(np.uint8)
    matrix = homography(width, height, capture)
    border = tuple(int(value) for value in image.getpixel((0, 0)))
    warped = cv2.warpPerspective(pixels, matrix, (width, height), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=border)
    stream = io.BytesIO()
    Image.fromarray(warped).save(stream, format="JPEG", quality=capture["jpeg_quality"],
                               subsampling=0, optimize=False, progressive=False)
    return stream.getvalue(), matrix
