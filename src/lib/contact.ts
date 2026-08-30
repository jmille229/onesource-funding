/**
 * Single source of truth for the public phone and email.
 *
 * Every place that shows either — TopBar, Footer, GetStarted, whatever comes
 * next — imports from here rather than hardcoding a string. Changing an address
 * in one place is the difference between "we updated our number" and "we
 * updated our number in six files and forgot one that a customer will find".
 */

export const CONTACT = {
  /** Human-readable phone; TEL is the same digits formatted for tel: URIs. */
  phone: "+1 (215) 436-9121",
  phoneTel: "+12154369121",

  /** General inbox. Personal @os-funding.com addresses stay out of public HTML. */
  email: "info@os-funding.com",
} as const;

/**
 * Deliberately not a business hours string here. Response commitments belong on
 * the form and the footer where they qualify a specific promise ("we'll be in
 * touch within one business day"), not on constants read out of context.
 */
