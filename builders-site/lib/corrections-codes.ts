/** The corrections form's error codes and their fixed messages (a code, never user input, travels in a URL). */
export type ErrorCode = "slug" | "field" | "text" | "source_required" | "source" | "email" | "name" | "too_large" | "rate" | "antibot";
export const ERROR_TEXT: Record<ErrorCode, string> = {
  slug: "Unknown project.", field: "Choose what is wrong.", text: "The correction must be 10 to 1,000 characters.",
  source_required: "Add a source link for status, contract and date corrections.", source: "The source must be an https link.",
  email: "Enter a valid email address.", name: "Name and role can be at most 100 characters.", too_large: "The correction is too long.",
  rate: "Too many corrections from you today. Try again later.", antibot: "Anti-bot check failed, try again.",
};
/** What the visitor typed, put back into the form after a refused post (in the response body only, never a URL). */
export type FormValues = { field: string; text: string; source_url: string; email: string; name: string };
