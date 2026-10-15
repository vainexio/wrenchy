export default function PanelPreview({ v }) {
  return (
    <div className="discord">
      <div className="discord-embed" style={{ borderColor: v.color }}>
        <div className="discord-title">{v.title || 'Untitled'}</div>
        <div className="discord-desc">{v.description}</div>
        <div className="discord-footer">Talyer • Verification</div>
      </div>
      <button type="button" className="discord-button" disabled={!v.enabled}>
        {v.buttonEmoji && <span>{v.buttonEmoji}</span>}
        {v.buttonLabel || 'Verify'}
      </button>
      <p className="discord-reply">
        <span className="muted">Reply after clicking (only they see it):</span> {v.successMessage}
      </p>
    </div>
  );
}
