/** First focusable control. Hidden until Tab; jumps past the chrome. */
export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to content
    </a>
  );
}
