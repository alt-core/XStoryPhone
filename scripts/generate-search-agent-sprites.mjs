import fs from "node:fs";
import path from "node:path";

const cellWidth = 192;
const cellHeight = 208;
const columns = 8;
const rows = 9;
const outputPath = path.join(process.cwd(), "public/search-agent/search-agent-spritesheet.svg");
const bellOutputPath = path.join(process.cwd(), "public/system/incoming-call-bell.wav");

const idleFrames = [
  { x: 0, y: 113, rx: 66, ry: 66 },
  { x: 1, y: 111, rx: 67, ry: 65 },
  { x: 2, y: 108, rx: 66, ry: 67 },
  { x: 3, y: 106, rx: 65, ry: 68 },
  { x: 4, y: 109, rx: 66, ry: 67 },
  { x: 5, y: 112, rx: 67, ry: 65 }
];

const joyfulFrames = [
  { x: 0, y: 126, rx: 72, ry: 54 },
  { x: 1, y: 96, rx: 63, ry: 70 },
  { x: 2, y: 78, rx: 66, ry: 66 },
  { x: 3, y: 118, rx: 70, ry: 57 }
];

function ellipse(frame, row) {
  const cx = frame.x * cellWidth + cellWidth / 2;
  const cy = row * cellHeight + frame.y;
  return `  <ellipse cx="${cx}" cy="${cy}" rx="${frame.rx}" ry="${frame.ry}" fill="#f59e0b"/>`;
}

const svg = [
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth * columns}" height="${cellHeight * rows}" viewBox="0 0 ${cellWidth * columns} ${cellHeight * rows}">`,
  "  <!-- 1行目: 待機6フレーム -->",
  ...idleFrames.map((frame) => ellipse(frame, 0)),
  "  <!-- 4行目: 喜び4フレーム -->",
  ...joyfulFrames.map((frame) => ellipse(frame, 3)),
  "</svg>",
  ""
].join("\n");

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, svg);
const sampleRate = 44_100;
const durationSeconds = 0.9;
const sampleCount = Math.round(sampleRate * durationSeconds);
const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(36 + sampleCount * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(sampleCount * 2, 40);
for (let index = 0; index < sampleCount; index += 1) {
  const time = index / sampleRate;
  const pulseTime = time % 0.3;
  const envelope = pulseTime < 0.18 ? Math.sin(Math.PI * pulseTime / 0.18) : 0;
  const tone = Math.sin(2 * Math.PI * 660 * time) * 0.7 + Math.sin(2 * Math.PI * 880 * time) * 0.3;
  wav.writeInt16LE(Math.round(tone * envelope * 7_500), 44 + index * 2);
}
fs.mkdirSync(path.dirname(bellOutputPath), { recursive: true });
fs.writeFileSync(bellOutputPath, wav);
console.log(`検索エージェントのスプライトを生成しました: ${outputPath}`);
console.log(`着信音を生成しました: ${bellOutputPath}`);
