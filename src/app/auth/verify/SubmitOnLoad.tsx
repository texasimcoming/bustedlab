"use client";

import { useEffect } from "react";

// Sends the sign-in form as soon as the page is running in a real browser, so
// signing in stays one tap from the email.
export default function SubmitOnLoad({ formId }: { formId: string }) {
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!(form instanceof HTMLFormElement)) return;
    // requestSubmit arrived in Safari 16; older iPhones get the plain submit.
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }, [formId]);
  return null;
}
