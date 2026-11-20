// Made-up examples. Every value is fake: example.* addresses, a test card
// number, the IBAN from the standard's own documentation and AWS's example key.
export const SAMPLES = [
  {
    id: "clean",
    label: "Nothing spooky",
    text: "Write a friendly two-line welcome for new members of our book club. We meet on the first Thursday of the month.",
  },
  {
    id: "customer",
    label: "A customer email",
    text:
      "Draft a polite reply to Mary Byrne (mary.byrne@example.ie, +353 87 123 4567). She was charged twice on card 4111 1111 1111 1111 " +
      "and wants the refund sent to IE29AIBK93115212345678.",
  },
  {
    id: "health",
    label: "A sick note",
    text:
      "Summarise this for HR in two lines: Tom Walsh (tom.walsh@example.com) has been off since Monday. " +
      "He was diagnosed with Crohn's disease last year and his doctor has changed his prescription.",
  },
  {
    id: "secret",
    label: "A leaked key",
    text: "Why does this fail?\n\naws_access_key_id=AKIAIOSFODNN7EXAMPLE\naws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
];

/** What the agent is asked to do when you press "Watch an agent try". */
export const AGENT_PROMPT =
  "Write a short, kind note to the team saying Tom Walsh (tom.walsh@example.com) is off sick. " +
  "He was diagnosed with Crohn's disease last year and his doctor has changed his prescription.";
