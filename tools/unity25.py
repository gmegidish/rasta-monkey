"""Minimal readers for Unity 2.5 asset payloads omitted by modern typetrees."""
from dataclasses import dataclass
from pathlib import Path
import re
import struct
import wave
from typing import List

from PIL import Image
import UnityPy
from UnityPy.enums import BuildTarget
from UnityPy.export.Texture2DConverter import parse_image_data


@dataclass(frozen=True)
class TextureData:
    name: str
    width: int
    height: int
    format: int
    mipmap: bool
    data: bytes


@dataclass(frozen=True)
class AudioClipData:
    name: str
    format: int
    duration: float
    frequency: int
    data: bytes


PathLike = Path


def _read_aligned_name(data: bytes):
    length = struct.unpack_from("<i", data, 0)[0]
    if length < 0 or length > len(data) - 4:
        raise ValueError("Invalid Unity string length")
    name = data[4:4 + length].decode("utf-8", errors="replace")
    next_offset = (4 + length + 3) & ~3
    return name, next_offset


def parse_texture(data: bytes) -> TextureData:
    name, offset = _read_aligned_name(data)
    if len(data) < offset + 48:
        raise ValueError("Texture2D header is truncated")
    width, height, complete_size, texture_format, mipmap = struct.unpack_from("<5i", data, offset)
    image_size = struct.unpack_from("<i", data, offset + 44)[0]
    image_offset = offset + 48
    if width <= 0 or height <= 0 or image_size < 0 or image_offset + image_size > len(data):
        raise ValueError("Texture2D dimensions or image payload are invalid")
    if complete_size and image_size > complete_size:
        raise ValueError("Texture2D payload exceeds its declared complete size")
    return TextureData(name, width, height, texture_format, bool(mipmap), data[image_offset:image_offset + image_size])


def decode_texture(texture: TextureData) -> Image.Image:
    return parse_image_data(
        texture.data,
        texture.width,
        texture.height,
        texture.format,
        (2, 5, 0, 5),
        BuildTarget.iOS,
        flip=True,
    )


def parse_audio_clip(data: bytes) -> AudioClipData:
    name, offset = _read_aligned_name(data)
    if len(data) < offset + 24:
        raise ValueError("AudioClip header is truncated")
    audio_format, duration, frequency, sample_size = struct.unpack_from("<ifii", data, offset)
    if frequency <= 0 or duration < 0 or sample_size < 0 or sample_size > len(data):
        raise ValueError("AudioClip metadata is invalid")
    payload = data[len(data) - sample_size:] if sample_size else b""
    return AudioClipData(name, audio_format, duration, frequency, payload)


def _slug(name: str) -> str:
    value = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return value or "unnamed"


def export_textures(source: PathLike, destination: PathLike) -> List[Path]:
    destination.mkdir(parents=True, exist_ok=True)
    environment = UnityPy.load(str(source))
    exported = []
    occupied = set()
    for obj in environment.objects:
        if obj.type.name != "Texture2D":
            continue
        try:
            texture = parse_texture(obj.get_raw_data())
            basename = _slug(texture.name)
            filename = f"{basename}.png"
            if filename in occupied:
                asset_name = _slug(Path(obj.assets_file.name).stem)
                filename = f"{basename}-{asset_name}-{obj.path_id}.png"
            output = destination / filename
            decode_texture(texture).save(output)
            occupied.add(filename)
            exported.append(output)
        except (ValueError, NotImplementedError):
            continue
    return exported


def export_pcm_audio(source: PathLike, destination: PathLike) -> List[Path]:
    """Export Unity 2.5 format-2 mono 16-bit PCM clips as WAV files."""
    destination.mkdir(parents=True, exist_ok=True)
    environment = UnityPy.load(str(source))
    exported = []
    occupied = set()
    for obj in environment.objects:
        if obj.type.name != "AudioClip":
            continue
        try:
            clip = parse_audio_clip(obj.get_raw_data())
        except ValueError:
            continue
        if clip.format != 2 or not clip.data:
            continue
        basename = _slug(clip.name)
        filename = f"{basename}.wav"
        if filename in occupied:
            asset_name = _slug(Path(obj.assets_file.name).stem)
            filename = f"{basename}-{asset_name}-{obj.path_id}.wav"
        output = destination / filename
        with wave.open(str(output), "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(clip.frequency)
            audio.writeframes(clip.data)
        occupied.add(filename)
        exported.append(output)
    return exported
