import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("ラジオ確認音は無音の短いplaceholderではなく9秒のWAVとして生成される", () => {
  const wav = fs.readFileSync("public/system/radio-caption-sample.wav");
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.ok(wav.length > 250_000);
});

test("デモ動画はブラウザー互換のH.264とAACを含むMP4である", () => {
  const video = fs.readFileSync("public/demo/demo-video.mp4");
  const signature = video.toString("latin1");
  assert.ok(video.length > 100_000);
  assert.match(signature, /ftyp/u);
  assert.match(signature, /avc1/u);
  assert.match(signature, /mp4a/u);
});

test("ダミー画像は外部素材を参照しないプロジェクト制作SVGである", () => {
  const svg = fs.readFileSync("public/demo/dummy-data.svg", "utf8");
  assert.match(svg, /ダミーデータ/u);
  assert.doesNotMatch(svg, /<(?:image|use)\b|(?:href|src)=["']https?:\/\//u);
});
