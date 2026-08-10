export type MigrationMode = "plan" | "apply";

export const migrationMode = (arguments_: ReadonlyArray<string>): MigrationMode => {
  const unknown = arguments_.filter((argument) => argument !== "--plan" && argument !== "--apply");

  if (unknown.length > 0) {
    throw new Error(`unknown migration argument(s): ${unknown.join(", ")}`);
  }

  if (arguments_.includes("--plan") && arguments_.includes("--apply")) {
    throw new Error("choose either --plan or --apply");
  }

  return arguments_.includes("--apply") ? "apply" : "plan";
};
