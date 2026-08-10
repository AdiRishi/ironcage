export default {
  fetch() {
    return new Response("ironcage-agents: hello world\n");
  },
} satisfies ExportedHandler<Env>;
