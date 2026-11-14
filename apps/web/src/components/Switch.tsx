/** On/off switch. aria-pressed carries the state for screen readers and for the CSS. */
export function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="switch" aria-pressed={on} aria-label={label} onClick={onToggle}>
      <span />
    </button>
  );
}
