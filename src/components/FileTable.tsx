import { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Cloud,
  File,
  FileImage,
  FileText,
  LockKeyhole,
  Music,
  Upload,
} from 'lucide-react';
import { sizeLabel, type FileEntry } from '../domain';
import type { Workspace } from '../useWorkspace';
export function FileIcon({ file }: { file: FileEntry }) {
  const Icon = ['jpg', 'jpeg', 'png', 'webp'].includes(file.extension)
    ? FileImage
    : ['mp3', 'mp4', 'wav', 'm4a'].includes(file.extension)
      ? Music
      : ['pdf', 'txt', 'md', 'csv'].includes(file.extension)
        ? FileText
        : File;
  return <Icon size={16} />;
}
export function FileTable({
  w,
  compact,
  showSize,
}: {
  w: Workspace;
  compact: boolean;
  showSize: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState({ height: 600, top: 0 });
  useEffect(() => {
    const el = ref.current!;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: el.clientHeight })),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
      setViewport((v) => ({ ...v, top: 0 }));
    }
  }, [w.query, w.type, w.onlyChanged, compact]);
  const height = compact ? 30 : 38,
    virtual = w.visible.length > 200;
  const start = virtual
    ? Math.min(
        Math.max(0, w.visible.length - 1),
        Math.max(0, Math.floor((viewport.top - 33) / height) - 8),
      )
    : 0;
  const end = virtual
    ? Math.min(w.visible.length, start + Math.ceil(viewport.height / height) + 18)
    : w.visible.length;
  const visible = w.visible.slice(start, end);
  return (
    <div
      className="table-scroll"
      ref={ref}
      onScroll={(e) => {
        if (virtual) {
          const top = e.currentTarget.scrollTop;
          setViewport((v) => ({ ...v, top }));
        }
      }}
    >
      <table
        className={`file-table ${showSize ? '' : 'hide-size'}`}
        aria-label="文件与命名预览"
        aria-rowcount={w.visible.length + 1}
      >
        <thead>
          <tr>
            <th className="check-col" aria-label="选择" />
            <th>
              原名称 <span aria-hidden="true">↑</span>
            </th>
            <th>新名称</th>
            {showSize && <th className="size-col">大小</th>}
            <th className="policy-col">AI 权限</th>
            <th className="state-col">状态</th>
          </tr>
        </thead>
        <tbody>
          {start > 0 && (
            <tr aria-hidden="true" className="virtual-spacer">
              <td colSpan={showSize ? 6 : 5} style={{ height: start * height }} />
            </tr>
          )}
          {visible.map((file, index) => {
            const selected = w.selected.has(file.id),
              p = w.byId.get(file.id),
              name = w.changeMap.get(file.id) ?? file.name,
              changed = name !== file.name;
            const Permission =
              file.policy === 'deny' ? Ban : file.policy === 'cloud' ? Cloud : LockKeyhole;
            return (
              <tr
                key={file.id}
                aria-rowindex={start + index + 2}
                className={`${selected ? 'selected' : ''} ${p?.error ? 'row-error' : ''} ${w.activeFile === file.id ? 'focused-row' : ''}`}
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${file.name}`}
                    checked={selected}
                    disabled={!!w.busy}
                    onChange={() => w.toggle(file.id)}
                  />
                </td>
                <td>
                  <button
                    className={`file-name ${['jpg', 'jpeg', 'png', 'webp'].includes(file.extension) ? 'image' : ''}`}
                    title={file.path}
                    onClick={() => w.setActiveFile(file.id)}
                  >
                    <FileIcon file={file} />
                    <span>{file.name}</span>
                  </button>
                </td>
                <td>
                  {selected ? (
                    <input
                      className={`name-edit ${changed ? '' : 'same'}`}
                      aria-label={`${file.name} 的新名称`}
                      aria-invalid={!!p?.error}
                      title={p?.error ?? w.reasons[file.id] ?? name}
                      value={name}
                      disabled={!!w.busy}
                      onFocus={() => w.setActiveFile(file.id)}
                      onChange={(e) => w.setEdits((old) => ({ ...old, [file.id]: e.target.value }))}
                    />
                  ) : (
                    <span className="file-meta">—</span>
                  )}
                </td>
                {showSize && <td className="file-meta">{sizeLabel(file.size)}</td>}
                <td>
                  <span className={`policy ${file.policy}`}>
                    <Permission size={11} />
                    {file.policy === 'deny'
                      ? '禁止 AI'
                      : file.policy === 'cloud'
                        ? '云端'
                        : '仅本地'}
                  </span>
                </td>
                <td>
                  <span
                    className={`state-tag ${p?.error ? 'error' : !selected || !changed ? 'same' : ''}`}
                    title={p?.error ?? undefined}
                  >
                    {p?.error ? (
                      <Ban size={12} />
                    ) : selected && changed ? (
                      <Check size={12} />
                    ) : null}
                    {p?.error
                      ? '名称冲突'
                      : !selected
                        ? '未选择'
                        : changed
                          ? w.planReady
                            ? '待执行'
                            : '检查中'
                          : '未更改'}
                  </span>
                </td>
              </tr>
            );
          })}
          {end < w.visible.length && (
            <tr aria-hidden="true" className="virtual-spacer">
              <td
                colSpan={showSize ? 6 : 5}
                style={{ height: (w.visible.length - end) * height }}
              />
            </tr>
          )}
          {w.files.length > 0 && w.visible.length === 0 && (
            <tr>
              <td className="no-match" colSpan={showSize ? 6 : 5}>
                没有匹配的文件
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {w.files.length === 0 ? (
        <div className="empty-files">
          <Upload size={24} />
          <strong>拖入文件或文件夹</strong>
          <div>
            <button onClick={() => void w.choose()}>添加文件</button>
            {!w.desktop && (
              <button className="subtle" onClick={w.loadSample}>
                载入示例
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-blank">
          <Upload size={14} />
          拖入文件或文件夹
        </div>
      )}
    </div>
  );
}
