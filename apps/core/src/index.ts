export default {
  fetch() {
    return new Response("ironcage-core: hello world\n");
  },
} satisfies ExportedHandler<Env>;
