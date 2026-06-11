import { X } from "lucide-react";
import type { AppTheme } from "../theme.js";

const skins: Array<{ id: AppTheme; name: string; description: string }> = [
  {
    id: "classic",
    name: "经典绒布",
    description: "墨绿牌桌绒布与暖金按钮的原版皮肤。"
  },
  {
    id: "pixel",
    name: "像素小屋",
    description: "奶白像素网格底纹，草莓粉、奶黄、薄荷、天蓝的糖果色像素皮肤。"
  }
];

export function SettingsDialog({
  theme,
  onThemeChange,
  onClose
}: {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
      <section className="app-settings-dialog">
        <div className="app-settings-header">
          <h2 id="app-settings-title">设置</h2>
          <button className="app-settings-close" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="app-skin-section" role="radiogroup" aria-label="皮肤">
          <h3>皮肤</h3>
          {skins.map((skin) => {
            const selected = skin.id === theme;
            return (
              <button
                key={skin.id}
                className={`app-skin-option ${selected ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onThemeChange(skin.id)}
              >
                <span className={`app-skin-preview skin-${skin.id}`} aria-hidden="true">
                  {skin.id === "pixel" && (
                    <>
                      <i className="swatch-strawberry" />
                      <i className="swatch-butter" />
                      <i className="swatch-mint" />
                      <i className="swatch-sky" />
                    </>
                  )}
                </span>
                <span className="app-skin-info">
                  <strong>{skin.name}</strong>
                  <span>{skin.description}</span>
                </span>
                <span className="app-skin-state">{selected ? "使用中" : "启用"}</span>
              </button>
            );
          })}
        </div>

        <p className="app-settings-note">更多设置将在正式版开放。</p>
      </section>
    </div>
  );
}
