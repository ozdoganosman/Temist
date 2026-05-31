import type { ActiveDrawingTool } from './types';

interface DrawingToolbarProps {
  activeTool: ActiveDrawingTool;
  setActiveTool: (tool: ActiveDrawingTool) => void;
  onClearAll: () => void;
}

export default function DrawingToolbar({
  activeTool,
  setActiveTool,
  onClearAll,
}: DrawingToolbarProps) {
  const tools: Array<{ id: ActiveDrawingTool; label: string; icon: string; title: string }> = [
    { id: 'pointer', label: 'Pointer', icon: '🖱️', title: 'İmleç / Gezinme' },
    { id: 'trend', label: 'Trend', icon: '📈', title: 'Trend Çizgisi (İki Nokta)' },
    { id: 'horizontal', label: 'Horizontal', icon: '➖', title: 'Yatay Çizgi / Destek & Direnç' },
    { id: 'fibonacci', label: 'Fibonacci', icon: '📐', title: 'Fibonacci Düzeyleri (Tepe-Dip)' },
  ];

  return (
    <div className="drawing-toolbar" role="toolbar" aria-label="Çizim araçları">
      {tools.map((t) => (
        <button
          key={t.id}
          className={`drawing-tool-btn ${activeTool === t.id ? 'active' : ''}`}
          onClick={() => setActiveTool(t.id)}
          title={t.title}
          aria-label={t.title}
        >
          {t.icon}
        </button>
      ))}
      <div style={{ height: '1px', background: 'var(--border-primary)', margin: '4px 2px' }} />
      <button
        className="drawing-tool-btn clear-btn"
        onClick={() => {
          if (confirm('Tüm çizimlerinizi silmek istediğinize emin misiniz?')) {
            onClearAll();
          }
        }}
        title="Tüm Çizimleri Temizle"
        aria-label="Tüm Çizimleri Temizle"
      >
        🗑️
      </button>
    </div>
  );
}
