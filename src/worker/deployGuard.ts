export default {
  fetch() {
    return new Response("デプロイ先をdev・stg・prodから明示してください。", { status: 503 });
  }
};
