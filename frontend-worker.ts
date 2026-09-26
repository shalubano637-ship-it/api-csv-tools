export default {
  async fetch() {
    return new Response("API CSV Tools Worker is live", {
      status: 200,
      headers: { "content-type": "text/plain; charset=UTF-8" },
    });
  },
};
