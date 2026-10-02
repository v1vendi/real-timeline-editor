// Pure edit commands: (seq, args) => seq. Structural sharing; an unchanged result returns the
// same `seq` reference (no-op: locked track, missing id, nothing to do). Beats are quantized.
// Barrel: the commands live in the sibling *Commands.ts files, grouped by concern.
export * from "./sectionCommands";
export * from "./keyCommands";
export * from "./trackCommands";
export * from "./audioCommands";
