/** First focusable control. Hidden until Tab; jumps past the chrome to #main. */
export function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to content
    </a>
  );
}
