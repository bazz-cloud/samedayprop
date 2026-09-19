/**
 * The e-signature consent wording.
 *
 * It lives here, in a plain module, rather than beside the action that records
 * it: a `'use server'` file may only export async functions, so exporting this
 * string from `actions.ts` made the built server throw
 * "A 'use server' file can only export async functions, found string" the
 * moment anything imported the module — which meant no purchase could be
 * completed in a production build at all. Both the form that displays it and
 * the action that stores it import it from here, so the text a customer reads
 * and the text written to the acceptance record stay the same string.
 */
export const CONSENT_WORDING =
  'I have read this document, I agree to it, and I intend my typed legal name below to be my ' +
  'signature. I understand trading in this program is simulated and that my simulated account ' +
  'balance is not cash held for me.';
