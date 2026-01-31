import { z } from 'zod';
import {
  AgentIdSchema,
  CapabilitySchema,
  AttestationSchema,
  ChallengeResponseSchema,
} from './types';

/**
 * Validate and parse agent ID data
 */
export function validateAgentId(data: unknown) {
  return AgentIdSchema.parse(data);
}

/**
 * Validate and parse capability data
 */
export function validateCapability(data: unknown) {
  return CapabilitySchema.parse(data);
}

/**
 * Validate and parse attestation data
 */
export function validateAttestation(data: unknown) {
  return AttestationSchema.parse(data);
}

/**
 * Validate challenge response
 */
export function validateChallengeResponse(data: unknown) {
  return ChallengeResponseSchema.parse(data);
}

/**
 * Safe parse with error details
 */
export function safeParse<T extends z.ZodType>(
  schema: T,
  data: unknown
): { success: true; data: z.infer<T> } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error };
}
