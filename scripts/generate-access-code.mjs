import { createHmac } from "node:crypto";

const secret = process.env.ACCESS_CODE_SECRET?.trim() ?? "";
const args = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizedCounter(value) {
  if (!/^\d{1,4}$/u.test(value)) fail("連番は0から9999の数字で指定してください。");
  return value.padStart(4, "0");
}

function accessCode(counter) {
  const signature = createHmac("sha256", secret).update(`access:${counter}`).digest();
  const checkDigits = String(signature.readUInt32BE(0) % 10_000).padStart(4, "0");
  return `${checkDigits}${counter}`;
}

function usage() {
  return [
    "使い方: ACCESS_CODE_SECRET=... npm run access-code -- 0001",
    "        ACCESS_CODE_SECRET=... npm run access-code -- --from 0001 --count 100"
  ].join("\n");
}

if (!secret) fail("ACCESS_CODE_SECRETを環境変数で指定してください。");

let counterArgument = "";
let fromArgument = "";
let countArgument = "";
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--from" || argument === "--count") {
    const value = args[index + 1] ?? "";
    if (argument === "--from") fromArgument = value;
    else countArgument = value;
    index += 1;
  } else if (argument.startsWith("--")) {
    fail(`未知のオプションです: ${argument}`);
  } else if (counterArgument) {
    fail("連番は1つだけ指定してください。");
  } else {
    counterArgument = argument;
  }
}

if (fromArgument || countArgument) {
  if (counterArgument || !fromArgument || !/^\d+$/u.test(countArgument)) fail(usage());
  const first = Number(normalizedCounter(fromArgument));
  const count = Number(countArgument);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000 || first + count > 10_000) {
    fail("countは1から10000の範囲で、連番が9999を超えないよう指定してください。");
  }
  for (let offset = 0; offset < count; offset += 1) {
    console.log(accessCode(String(first + offset).padStart(4, "0")));
  }
} else {
  if (!counterArgument) fail(usage());
  console.log(accessCode(normalizedCounter(counterArgument)));
}
