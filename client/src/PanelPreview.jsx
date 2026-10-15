// Renders **bold** like Discord does; everything else is shown as plain text.
function renderMarkdown(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}

export default function PanelPreview({ v }) {
  return (
    <div className="discord">
      <div className="discord-content">{renderMarkdown(v.content || '')}</div>
      <button type="button" className="discord-button" disabled={!v.enabled}>
        {v.buttonEmoji && <span>{v.buttonEmoji}</span>}
        {v.buttonLabel || 'Verify'}
      </button>
      <p className="discord-reply">
        <span className="muted">Reply after clicking (only they see it):</span> {renderMarkdown(v.successMessage || '')}
      </p>
    </div>
  );
}
