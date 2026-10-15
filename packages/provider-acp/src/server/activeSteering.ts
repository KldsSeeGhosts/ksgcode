import * as Schema from "effect/Schema";

const Advertisement = Schema.Struct({
  version: Schema.Literal(1),
  idempotent: Schema.Literal(true),
  holdsPrompt: Schema.Literal(true),
});
const isAdvertisement = Schema.is(Advertisement);

/**
 * Opt-in ACP extension, not a standard ACP capability. The agent deduplicates
 * message IDs and owns all admitted input until the original prompt completes,
 * including a native queue fallback at the end-of-turn boundary.
 */
export function supportsAcpActiveSteering(
  meta: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return isAdvertisement(meta?.["t3code/steering"]);
}

const AcpSteerResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal("accepted") }),
  // Both refusals guarantee that no native input was admitted. A transport
  // failure or malformed response provides no such guarantee.
  Schema.Struct({ status: Schema.Literal("turn_settled") }),
  Schema.Struct({
    status: Schema.Literal("rejected"),
    reason: Schema.String,
  }),
]);

export const decodeAcpSteerResponse = Schema.decodeUnknownEffect(AcpSteerResponse);
