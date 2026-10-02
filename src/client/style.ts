/**
 * Plugin stylesheet. Every color comes from DSH's `--dsw-*` design tokens
 * (with neutral fallbacks), so light/dark themes follow the host. Metrics
 * mirror DSH's own pages (ui-schedule): 14px body, 20px/500 page title,
 * 28px pill filters, 8–10px radii, hairline borders.
 */
export const STYLE = String.raw`
.dig-root{--dig-fg:var(--dsw-alias-label-primary,#1f2329);--dig-fg2:var(--dsw-alias-label-secondary,#4e5969);--dig-fg3:var(--dsw-alias-label-tertiary,#86909c);--dig-caption:var(--dsw-alias-label-caption,#a9aeb8);--dig-bg:var(--dsw-alias-bg-base,#fff);--dig-layer:var(--dsw-alias-bg-layer-1,#f7f8fa);--dig-side:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1,#f7f8fa));--dig-hover:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));--dig-border:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--dig-border-soft:var(--dsw-alias-border-l4,rgba(0,0,0,.06));--dig-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--dig-danger:var(--dsw-alias-state-error-primary,#e5484d);--dig-focus:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));--dig-radius:10px;--dig-elev:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.12));color:var(--dig-fg);background:var(--dig-bg);font-size:14px;line-height:1.6;box-sizing:border-box}
.dig-root *,.dig-root *::before,.dig-root *::after{box-sizing:border-box}
.dig-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden}
.dig-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 18px;flex:none}
.dig-head h1{margin:0;font-size:20px;font-weight:500;line-height:28px;flex:none}
.dig-tabs{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto}
.dig-tab{height:28px;padding:0 12px;border:0;border-radius:14px;background:transparent;color:var(--dig-fg3);font:inherit;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;flex:none}
.dig-tab:hover{background:var(--dig-hover);color:var(--dig-fg)}
.dig-tab[aria-selected=true]{background:var(--dig-hover);color:var(--dig-fg);font-weight:500}
.dig-spacer{flex:1}
.dig-body{flex:1;min-height:0;display:flex;border-top:.5px solid var(--dig-border-soft)}
.dig-scroll{overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
.dig-side{width:272px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:.5px solid var(--dig-border-soft);background:var(--dig-side)}
.dig-side-section{padding:12px 12px 4px}
.dig-section-title{display:flex;align-items:center;justify-content:space-between;color:var(--dig-fg3);font-size:12px;line-height:20px;padding:0 6px 4px}
.dig-proj-list{display:flex;flex-direction:column;gap:1px;max-height:34vh;overflow:auto}
.dig-proj{display:flex;align-items:center;gap:8px;height:34px;padding:0 6px 0 10px;border-radius:8px;cursor:pointer;color:var(--dig-fg);user-select:none;position:relative}
.dig-proj:hover{background:var(--dig-hover)}
.dig-proj[aria-current=true]{background:var(--dig-hover);font-weight:500}
.dig-proj-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dig-proj-count{color:var(--dig-caption);font-size:12px}
.dig-proj .dig-icon-btn{opacity:0}
.dig-proj:hover .dig-icon-btn,.dig-proj .dig-icon-btn[aria-expanded=true]{opacity:1}
.dig-proj-input{flex:1;min-width:0;height:26px;border:1px solid var(--dig-accent);border-radius:6px;background:var(--dig-bg);color:var(--dig-fg);font:inherit;padding:0 6px;outline:none}
.dig-params{flex:1;min-height:0;padding:8px 18px 18px;display:flex;flex-direction:column;gap:14px;border-top:.5px solid var(--dig-border-soft)}
.dig-field{display:flex;flex-direction:column;gap:6px}
.dig-label{font-size:12px;line-height:20px;color:var(--dig-fg2);display:flex;align-items:center;justify-content:space-between;gap:8px}
.dig-hint{font-size:12px;line-height:18px;color:var(--dig-fg3)}
.dig-select,.dig-input,.dig-textarea{width:100%;min-width:0;border:.5px solid var(--dsw-alias-border-l4,var(--dig-border));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,var(--dig-bg));color:var(--dig-fg);font:inherit;font-size:13px;line-height:1.5;outline:none;transition:border-color .13s}
.dig-select,.dig-input{height:34px;padding:0 12px}
.dig-select:hover:not(:disabled),.dig-input:hover:not(:disabled),.dig-textarea:hover:not(:disabled){border-color:var(--dsw-alias-border-l3,var(--dig-border))}
.dig-select-wrap{position:relative;display:flex;min-width:0;width:100%}
.dig-select-compact{width:auto;min-width:150px;flex:none}
.dig-select{display:flex;align-items:center;gap:8px;text-align:left;cursor:pointer;padding-right:10px}
.dig-select:disabled{color:var(--dig-fg3);cursor:default}
.dig-select-open{border-color:var(--dig-accent)!important}
.dig-select-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dig-select-placeholder{color:var(--dig-fg3)}
.dig-select-chevron{flex:none;color:var(--dig-fg3);transition:transform .15s ease}
.dig-select-open .dig-select-chevron{transform:rotate(180deg)}
.dig-menu-pop,.dig-menu{position:fixed;z-index:1100;box-sizing:border-box;min-width:160px;padding:4px;overflow-y:auto;overscroll-behavior:contain;border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-menu-surface-fill,var(--dsw-alias-bg-layer-1,var(--dig-bg)));backdrop-filter:var(--dsw-menu-backdrop-filter,none);-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,none);box-shadow:var(--dsw-elevation-prominent,0 10px 32px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.1));color:var(--dig-fg);animation:dig-menu-in .12s ease-out}
@keyframes dig-menu-in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
.dig-menu-label{padding:6px 8px 2px;color:var(--dig-fg3);font-size:11px;line-height:16px;font-weight:500;user-select:none}
.dig-menu-label:not(:first-child){margin-top:4px;padding-top:8px;border-top:.5px solid var(--dig-border)}
.dig-menu-item{display:flex;align-items:center;gap:8px;min-height:34px;padding:6px 8px;border-radius:var(--dsw-radius-md,8px);color:var(--dig-fg);font-size:13px;line-height:20px;cursor:pointer;user-select:none}
.dig-menu-item-active{background:var(--dig-hover)}
.dig-menu-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dig-menu-detail{flex:none;color:var(--dig-fg3);font-size:12px;line-height:18px}
.dig-menu-check{flex:none;display:inline-flex;width:14px;height:14px;color:var(--dig-fg)}
.dig-menu-filter{position:sticky;top:-4px;z-index:1;margin:-4px -4px 4px;padding:8px 8px 4px;background:inherit}
.dig-menu-filter .dig-input{height:30px}
.dig-menu-empty{padding:8px;color:var(--dig-fg3);font-size:12px;text-align:center}
@media (prefers-reduced-motion:reduce){.dig-menu-pop,.dig-menu{animation:none}.dig-select-chevron{transition:none}}
.dig-textarea{padding:8px 10px;resize:vertical;min-height:64px;line-height:1.55}
.dig-select:focus-visible,.dig-input:focus,.dig-textarea:focus{border-color:var(--dig-focus)}
.dig-chips{display:flex;flex-wrap:wrap;gap:6px}
.dig-chip{min-width:44px;height:28px;padding:0 10px;border-radius:8px;border:.5px solid var(--dig-border);background:var(--dig-bg);color:var(--dig-fg2);font:inherit;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.dig-chip:hover{background:var(--dig-hover);color:var(--dig-fg)}
.dig-chip[aria-pressed=true]{border-color:var(--dig-accent);color:var(--dig-accent);background:color-mix(in srgb,var(--dig-accent) 8%,transparent)}
.dig-ratio-glyph{display:inline-block;border:1.5px solid currentColor;border-radius:2px}
.dig-btn{height:32px;padding:0 14px;border-radius:16px;border:.5px solid var(--dig-border);background:var(--dig-bg);color:var(--dig-fg);font:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.dig-btn:hover:not(:disabled){background:var(--dig-hover)}
.dig-btn:disabled{opacity:.5;cursor:not-allowed}
.dig-btn-primary{background:var(--dig-accent);border-color:var(--dig-accent);color:#fff}
.dig-btn-primary:hover:not(:disabled){background:color-mix(in srgb,var(--dig-accent) 88%,#000)}
.dig-btn-danger{color:var(--dig-danger)}
.dig-btn-sm{height:28px;padding:0 10px;font-size:12px;border-radius:14px}
.dig-icon-btn{width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dig-fg3);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0}
.dig-icon-btn:hover:not(:disabled){background:var(--dig-hover);color:var(--dig-fg)}
.dig-icon-btn:disabled{opacity:.4;cursor:not-allowed}
.dig-icon-btn[aria-pressed=true]{color:#f5a623}
.dig-root button:focus-visible,.dig-root [tabindex]:focus-visible{outline:2px solid var(--dig-focus);outline-offset:1px}
.dig-center{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dig-board{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:24px 24px 36px;position:relative;overflow:hidden}
.dig-board-empty{display:flex;flex-direction:column;align-items:center;gap:12px;color:var(--dig-fg3);text-align:center;max-width:360px}
.dig-board-empty svg{color:var(--dig-caption)}
.dig-board-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);background:var(--dig-layer);cursor:zoom-in}
.dig-board-grid{display:grid;gap:12px;width:100%;height:100%;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr)}
.dig-board-grid .dig-board-cell{min-height:0;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;position:relative}
.dig-board-grid .dig-board-cell[aria-current=true]{outline:2px solid var(--dig-accent);outline-offset:2px}
.dig-board-grid img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px}
.dig-board-tools{position:absolute;top:12px;right:16px;display:flex;gap:4px;padding:4px;border-radius:10px;background:color-mix(in srgb,var(--dig-bg) 88%,transparent);backdrop-filter:blur(8px);box-shadow:0 1px 4px rgba(0,0,0,.08)}
.dig-board-meta{position:absolute;left:16px;right:16px;bottom:10px;color:var(--dig-fg3);font-size:12px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dig-busy{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--dig-fg3)}
.dig-spin{animation:dig-spin 1s linear infinite}
@keyframes dig-spin{to{transform:rotate(360deg)}}
.dig-skeleton{border-radius:8px;background:linear-gradient(90deg,var(--dig-layer),var(--dig-hover),var(--dig-layer));background-size:200% 100%;animation:dig-shimmer 1.4s ease-in-out infinite}
@keyframes dig-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.dig-composer{flex:none;margin:0 24px 20px;border:.5px solid var(--dig-border);border-radius:16px;background:var(--dig-bg);box-shadow:0 2px 12px rgba(0,0,0,.04);padding:10px 12px 10px 14px;display:flex;flex-direction:column;gap:8px}
.dig-composer:focus-within{border-color:var(--dig-focus)}
.dig-composer textarea{border:0;outline:none;resize:none;background:transparent;color:var(--dig-fg);font:inherit;font-size:14px;line-height:1.6;min-height:68px;width:100%;padding:0;overflow-y:auto}
.dig-composer-row{display:flex;align-items:center;gap:8px}
.dig-refs{display:flex;gap:8px;flex-wrap:wrap}
.dig-ref{width:52px;height:52px;border-radius:8px;overflow:hidden;position:relative;border:.5px solid var(--dig-border);background:var(--dig-layer)}
.dig-ref img{width:100%;height:100%;object-fit:cover}
.dig-ref button{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:9px;border:0;background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.dig-history{width:112px;flex:none;border-left:.5px solid var(--dig-border-soft);display:flex;flex-direction:column;min-height:0;background:var(--dig-side)}
.dig-board:focus{outline:none}
.dig-new-canvas{margin:4px 12px 0;justify-content:center}
.dig-proj-busy{flex:none;color:var(--dig-accent)}
.dig-history-list{flex:1;min-height:0;padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}
.dig-thumb{width:100%;aspect-ratio:1;border-radius:8px;overflow:hidden;position:relative;cursor:pointer;border:.5px solid var(--dig-border-soft);background:var(--dig-layer);flex:none;padding:0}
.dig-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.dig-thumb[aria-current=true]{outline:2px solid var(--dig-accent);outline-offset:1px}
.dig-thumb .dig-thumb-del{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:10px;border:0;background:rgba(0,0,0,.55);color:#fff;display:none;align-items:center;justify-content:center;cursor:pointer;padding:0}
.dig-thumb:hover .dig-thumb-del{display:flex}
.dig-board-error{display:flex;align-items:flex-start;gap:8px;flex-shrink:0;max-height:96px}
.dig-board-error-text{flex:1;min-width:0;max-height:78px;overflow:auto}
.dig-error{margin:0 24px 10px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,var(--dig-danger) 10%,transparent);color:var(--dig-danger);font-size:12px;line-height:18px;white-space:pre-wrap;word-break:break-word}
.dig-notice{padding:12px 14px;border-radius:10px;background:var(--dig-side);color:var(--dig-fg2);font-size:12px;line-height:20px}
.dig-gallery{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dig-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 24px}
.dig-toolbar .dig-select-wrap{width:auto}
.dig-search{position:relative;flex:1;min-width:180px;max-width:360px}
.dig-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);z-index:1;pointer-events:none;color:var(--dig-fg3)}
.dig-search .dig-input{padding-left:32px;width:100%}
.dig-grid{flex:1;min-height:0;padding:4px 24px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:12px;align-content:start}
.dig-card{position:relative;border-radius:10px;overflow:hidden;background:var(--dig-layer);aspect-ratio:1;cursor:pointer;border:.5px solid var(--dig-border-soft)}
.dig-card img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .2s}
.dig-card:hover img{transform:scale(1.03)}
.dig-card-overlay{position:absolute;inset:auto 0 0 0;padding:20px 8px 6px;background:linear-gradient(transparent,rgba(0,0,0,.55));color:#fff;font-size:11px;line-height:16px;opacity:0;transition:opacity .15s;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dig-card:hover .dig-card-overlay{opacity:1}
.dig-card-check{position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:11px;border:1.5px solid #fff;background:rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;color:#fff}
.dig-card[aria-selected=true]{outline:2px solid var(--dig-accent);outline-offset:-2px}
.dig-card[aria-selected=true] .dig-card-check{background:var(--dig-accent);border-color:var(--dig-accent)}
.dig-card-star{position:absolute;top:6px;right:6px;color:#f5a623;filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}
.dig-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:64px 20px;color:var(--dig-fg3);grid-column:1/-1}
.dig-overlay{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);display:flex;align-items:stretch;justify-content:center}
.dig-lightbox{display:flex;width:100%;height:100%}
.dig-lightbox-stage{flex:1;min-width:0;display:flex;align-items:center;justify-content:center;padding:48px;position:relative}
.dig-lightbox-stage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 10px 40px rgba(0,0,0,.4)}
.dig-lightbox-info{width:320px;flex:none;background:var(--dig-bg);color:var(--dig-fg);padding:20px;display:flex;flex-direction:column;gap:12px;overflow:auto}
.dig-lightbox-info h3{margin:0;font-size:14px;font-weight:500}
.dig-lightbox-prompt{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.6;background:var(--dig-layer);border-radius:8px;padding:10px 12px;max-height:40vh;overflow:auto}
.dig-kv{display:grid;grid-template-columns:72px 1fr;gap:4px 8px;font-size:12px;color:var(--dig-fg2)}
.dig-kv dt{color:var(--dig-fg3)}
.dig-kv dd{margin:0;word-break:break-all}
.dig-lightbox-actions{display:flex;flex-wrap:wrap;gap:8px}
.dig-lightbox-close{position:absolute;top:14px;left:14px;color:#fff;background:rgba(255,255,255,.12)}
.dig-lightbox-close:hover{background:rgba(255,255,255,.22)!important;color:#fff!important}
.dig-nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:20px;color:#fff;background:rgba(255,255,255,.12);border:0;cursor:pointer;display:flex;align-items:center;justify-content:center}
.dig-nav:hover{background:rgba(255,255,255,.24)}
.dig-modal-wrap{position:fixed;inset:0;z-index:1001;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;padding:16px}
.dig-modal{width:min(420px,100%);background:var(--dig-bg);color:var(--dig-fg);border-radius:14px;box-shadow:var(--dig-elev);padding:20px;display:flex;flex-direction:column;gap:14px}
.dig-size-row{display:flex;align-items:center;gap:6px}
.dig-size-row .dig-input{flex:1;min-width:0;text-align:center;font-variant-numeric:tabular-nums}
.dig-size-row .dig-icon-btn[aria-pressed=true]{color:var(--dig-accent)}
.dig-prompt-pop{display:flex;flex-direction:column;overflow:hidden}
.dig-prompt-save{width:100%;border:0;background:transparent;font:inherit;text-align:left;color:var(--dig-fg)}
.dig-prompt-save:hover:not(:disabled){background:var(--dig-hover)}
.dig-prompt-save:disabled{color:var(--dig-fg3);cursor:default}
.dig-prompt-pop .dig-menu-filter{position:relative;margin:4px 0;padding:0 4px}
.dig-prompt-pop .dig-menu-filter svg{left:14px}
.dig-prompt-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.dig-prompt-item{align-items:flex-start}
.dig-prompt-item-text{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word}
.dig-prompt-item .dig-icon-btn{width:24px;height:24px;opacity:0}
.dig-prompt-item:hover .dig-icon-btn,.dig-prompt-item-active .dig-icon-btn{opacity:1}
.dig-prompt-foot{padding:6px 8px 2px;border-top:.5px solid var(--dig-border-soft);color:var(--dig-fg3);font-size:11px}
.dig-bookmark-btn[aria-pressed=true]{color:var(--dig-accent)}
.dig-notice-warn{background:color-mix(in srgb,#f5a623 12%,transparent);color:var(--dig-fg)}
.dig-prompt-edit{resize:vertical;min-height:96px;font-size:13px;line-height:1.6;padding:8px 10px}
.dig-modal-wide{width:min(620px,100%)}
.dig-models{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-border-l4,var(--dig-border));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,var(--dig-bg));overflow:hidden}
.dig-model-row{display:flex;align-items:center;gap:8px;min-height:36px;padding:0 6px 0 12px;border-bottom:.5px solid var(--dig-border-soft)}
.dig-model-row:hover{background:var(--dig-hover)}
.dig-model-id{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace)}
.dig-model-action{border:0;background:transparent;color:var(--dig-fg3);font:inherit;font-size:12px;cursor:pointer;padding:2px 6px;border-radius:6px;opacity:0}
.dig-model-row:hover .dig-model-action,.dig-model-action:focus-visible{opacity:1}
.dig-model-action:hover{color:var(--dig-accent);background:var(--dig-hover)}
.dig-model-remove{opacity:0;width:24px;height:24px}
.dig-model-row:hover .dig-model-remove,.dig-model-remove:focus-visible{opacity:1}
.dig-model-add{display:flex;gap:8px;align-items:center;padding:8px}
.dig-model-add .dig-input{height:30px;background:var(--dig-bg)}
.dig-models-empty{padding:12px;color:var(--dig-fg3);font-size:12px;text-align:center;border-bottom:.5px solid var(--dig-border-soft)}
.dig-badge.dig-badge-accent{background:color-mix(in srgb,var(--dig-accent) 12%,transparent);color:var(--dig-accent)}
.dig-pick-list{max-height:min(46vh,420px);border:.5px solid var(--dig-border-soft);border-radius:8px;padding:4px}
.dig-pick-row{display:flex;align-items:center;gap:10px;min-height:32px;padding:0 8px;border-radius:6px;cursor:pointer}
.dig-pick-row:hover{background:var(--dig-hover)}
.dig-pick-added{cursor:default;color:var(--dig-fg3)}
.dig-pick-row input{accent-color:var(--dig-accent);margin:0}
.dig-composer-grip{height:10px;margin:-10px -12px -2px -14px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;touch-action:none}
.dig-composer-grip::before{content:"";width:36px;height:4px;border-radius:2px;background:var(--dig-border);opacity:0;transition:opacity .15s}
.dig-composer:hover .dig-composer-grip::before,.dig-composer-grip:focus-visible::before{opacity:1}
.dig-modal h2{margin:0;font-size:16px;font-weight:500}
.dig-modal-actions{display:flex;justify-content:flex-end;gap:8px}
.dig-menu button{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:6px 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer;text-align:left}
.dig-menu button:hover{background:var(--dig-hover)}
.dig-menu button.dig-danger{color:var(--dig-danger)}
.dig-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:1003;background:var(--dig-fg);color:var(--dig-bg);border-radius:8px;padding:8px 14px;font-size:13px;box-shadow:var(--dig-elev)}
.dig-prompts{padding:8px 24px 24px;display:flex;flex-direction:column;gap:8px;max-width:960px;width:100%;margin:0 auto}
.dig-prompt-row{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;border:.5px solid var(--dig-border-soft)}
.dig-prompt-row:hover{background:var(--dig-hover)}
.dig-prompt-text{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;font-size:13px}
/* settings */
.dig-settings{display:flex;min-height:520px;height:100%;border:.5px solid var(--dig-border-soft);border-radius:12px;overflow:hidden;background:var(--dig-bg)}
.dig-settings-list{width:220px;flex:none;border-right:.5px solid var(--dig-border-soft);background:var(--dig-side);display:flex;flex-direction:column;min-height:0}
.dig-settings-list .dig-proj{height:36px}
.dig-settings-detail{flex:1;min-width:0;padding:20px 24px 32px;display:flex;flex-direction:column;gap:18px}
.dig-settings-detail h2{margin:0;font-size:16px;font-weight:500;display:flex;align-items:center;gap:8px}
.dig-row{display:flex;gap:8px;align-items:center}
.dig-row>.dig-input,.dig-row>.dig-select{flex:1}
.dig-badge{font-size:11px;line-height:18px;padding:0 6px;border-radius:9px;background:var(--dig-hover);color:var(--dig-fg3);font-weight:400;flex:none}
.dig-badge-ok{background:color-mix(in srgb,#2fb36d 14%,transparent);color:#2a9d61}
.dig-dot{width:6px;height:6px;border-radius:3px;background:var(--dig-caption);flex:none}
.dig-dot-ok{background:#2fb36d}
.dig-switch{position:relative;width:34px;height:20px;flex:none;border-radius:10px;border:0;background:var(--dig-border);cursor:pointer;padding:0;transition:background .15s}
.dig-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.dig-switch[aria-checked=true]{background:var(--dig-accent)}
.dig-switch[aria-checked=true]::after{transform:translateX(14px)}
.dig-test-result{font-size:12px;line-height:18px}
.dig-test-ok{color:#2a9d61}
.dig-test-fail{color:var(--dig-danger)}
.dig-savebar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;background:var(--dig-side);border:.5px solid var(--dig-border)}
.dig-divider{height:.5px;background:var(--dig-border-soft);margin:2px 0}
.dig-card-chat{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0}
.dig-chat-img{position:relative;border-radius:10px;overflow:hidden;background:var(--dig-layer);border:.5px solid var(--dig-border-soft);max-width:min(420px,100%);cursor:zoom-in}
.dig-chat-img img{display:block;max-width:100%;max-height:420px;object-fit:contain}
.dig-chat-meta{font-size:12px;color:var(--dig-fg3);margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (max-width:900px){.dig-history{display:none}.dig-side{width:232px}}
@media (max-width:640px){.dig-head{grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 12px}.dig-head>.dig-tabs{grid-column:1/-1;grid-row:2}.dig-head>.dig-icon-btn{grid-column:2;grid-row:1}.dig-body{flex-direction:column}.dig-side{width:100%;max-height:42vh;border-right:0;border-bottom:.5px solid var(--dig-border-soft)}.dig-lightbox{flex-direction:column}.dig-lightbox-info{width:100%;max-height:45vh}.dig-settings{flex-direction:column}.dig-settings-list{width:100%;max-height:200px}}
`
