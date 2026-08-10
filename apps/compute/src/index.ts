export default {
  fetch() {
    return new Response("ironcage-compute: hello world\n");
  },
} satisfies ExportedHandler<Env>;
