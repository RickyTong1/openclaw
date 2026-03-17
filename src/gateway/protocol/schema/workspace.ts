import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const WorkspaceFilesListParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    prefix: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);

export const WorkspaceFilesListResultSchema = Type.Object(
  {
    files: Type.Array(
      Type.Object(
        {
          path: Type.String(),
          isDirectory: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
