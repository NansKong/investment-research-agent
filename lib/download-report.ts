/**
 * Triggers the browser's print dialog, which lets the user save the memo
 * as a PDF. Print-specific CSS in globals.css hides everything except the
 * memo, so the PDF looks exactly like the web version.
 */
export function downloadReport() {
  window.print();
}
