import { LockKeyhole, ShieldCheck, Sparkles } from 'lucide-react';
import type { Workspace } from '../useWorkspace';
export function AiAssistant({ w, openSettings }: { w: Workspace; openSettings: () => void }) {
  const selectedFile = w.files.find((f) => f.id === w.activeFile) ?? w.chosen[0];
  const limit = w.aiTask === 'rules' ? 200 : 20;
  return (
    <div role="tabpanel" id="pane-ai" aria-labelledby="tab-ai">
      <label className="field">
        AI 任务
        <select
          aria-label="AI 任务"
          value={w.aiTask}
          onChange={(e) => w.setAiTask(e.target.value as 'rules' | 'names')}
        >
          <option value="rules">自然语言 → 规则草案</option>
          <option value="names">逐文件命名（可选正文）</option>
        </select>
      </label>
      <label className="field">
        处理方式
        <select
          aria-label="处理方式"
          value={w.route}
          onChange={(e) => w.setRoute(e.target.value as 'local' | 'cloud')}
        >
          <option value="local">本地 Ollama</option>
          <option value="cloud">云端 API</option>
        </select>
      </label>
      {w.aiTask === 'rules' && (
        <details className="ai-context">
          <summary>目标示例与当前方案</summary>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={w.includeRules}
              onChange={(e) => w.setIncludeRules(e.target.checked)}
            />
            参考当前已启用规则
          </label>
          <p className="form-note">
            可继续要求调整原方案；替换整组仍需在草案中确认。示例与规则参数会列入发送预览。
          </p>
          {w.examples.map((example, i) => (
            <div className="ai-example" key={i}>
              <select
                aria-label={`示例${i + 1}文件`}
                value={example.id}
                onChange={(e) =>
                  w.setExamples(
                    w.examples.map((v, n) => (n === i ? { ...v, id: e.target.value } : v)),
                  )
                }
              >
                {w.chosen.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <input
                aria-label={`示例${i + 1}期望名称`}
                placeholder="期望的新文件名（含扩展名）"
                value={example.expected}
                onChange={(e) =>
                  w.setExamples(
                    w.examples.map((v, n) => (n === i ? { ...v, expected: e.target.value } : v)),
                  )
                }
              />
              <button
                aria-label={`删除示例${i + 1}`}
                onClick={() => w.setExamples(w.examples.filter((_, n) => n !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            disabled={
              w.examples.length >= 8 ||
              !w.chosen.some((f) => !w.examples.some((e) => e.id === f.id))
            }
            onClick={() => {
              const f = w.chosen.find((f) => !w.examples.some((e) => e.id === f.id));
              if (f) w.setExamples([...w.examples, { id: f.id, expected: '' }]);
            }}
          >
            添加目标示例
          </button>
        </details>
      )}
      {w.route === 'local' ? (
        <label className="field">
          本地模型
          <div className="model-row">
            <select
              aria-label="本地模型"
              value={w.model}
              onChange={(e) => w.setModel(e.target.value)}
            >
              <option value="">选择已下载模型</option>
              {w.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <button disabled={!w.desktop} onClick={() => void w.detectModels()}>
              检测
            </button>
          </div>
        </label>
      ) : (
        <div className="cloud-provider">
          <span>
            <LockKeyhole size={13} />
            {w.cloudModel}
            <small title={w.endpoint}>{w.endpoint}</small>
          </span>
          <button className="text-button" onClick={openSettings}>
            设置
          </button>
        </div>
      )}
      {w.aiTask === 'rules' && (
        <label className="field">
          参考文件名
          <select
            value={w.contextScope}
            onChange={(e) => w.setContextScope(e.target.value as typeof w.contextScope)}
          >
            <option value="selected">已选文件</option>
            <option value="visible">当前筛选列表</option>
            <option value="all">整个文件列表</option>
          </select>
        </label>
      )}
      <label className="field">
        命名要求
        <textarea
          aria-label="命名要求"
          rows={4}
          maxLength={8000}
          value={w.instruction}
          onChange={(e) => w.setInstruction(e.target.value)}
          placeholder="例如：加项目_前缀，空格替换为下划线，从 10 开始追加三位编号"
        />
      </label>
      <div className="quick-presets">
        {(w.aiTask === 'rules'
          ? [
              ['前缀 + 空格', '给文件名加“项目 A_”前缀，然后把所有空格换成下划线，保留扩展名。'],
              [
                '清理 + 编号',
                '根据列表文件名清理末尾副本或括号序号，再追加三位编号，从 1 开始，保留扩展名。',
              ],
              [
                '统一格式',
                '参考列表中的文件名，将空格替换成下划线，英文字母统一小写，保留扩展名。',
              ],
              [
                '提取重组',
                '参考实际文件名，提取客户、日期和合同号，日期统一 YYYY-MM-DD，按“日期_客户_合同号”重组。无法识别的标记出来，保留扩展名。',
              ],
              [
                '语义整理',
                '仅根据文件名，将名称整理为简洁清晰的中文；无法表达为通用规则的使用逐文件建议，不猜测内容。',
              ],
            ]
          : [
              ['合同', '按合同内容，以“日期_公司_主题”命名；缺失信息不猜测，保留扩展名。'],
              ['照片', '根据画面提炼简洁主题；仅使用可确认的日期，保留扩展名。'],
            ]
        ).map(([label, prompt]) => (
          <button key={label} onClick={() => w.setInstruction(prompt)}>
            {label}
          </button>
        ))}
      </div>
      {w.aiTask === 'names' ? (
        <>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={w.content}
              onChange={(e) => w.setContent(e.target.checked)}
            />
            理解文件内容
          </label>
          <details className="supported-formats">
            <summary>支持格式与限制</summary>
            <p>
              文本、文字 PDF、JPG / PNG / WebP。图片需要视觉模型；不支持 Office 正文、OCR
              和音视频转写。
            </p>
          </details>
        </>
      ) : (
        <p className="form-note">读取允许使用的文件名，不读取正文；生成规则后先审阅并更新预览。</p>
      )}
      <div className={`ai-permissions ${w.route === 'cloud' ? 'cloud' : ''}`}>
        <span>
          <ShieldCheck size={13} />
          {w.route === 'local' ? '仅本地处理' : '逐次授权云端发送'}
        </span>
        <span>
          {w.eligibleAiCount} 可参考 · {w.aiEntries.length - w.eligibleAiCount} 跳过
        </span>
      </div>
      {w.eligibleAiCount > limit && (
        <p className={w.aiTask === 'rules' ? 'form-note' : 'validation-error'}>
          {w.aiTask === 'rules'
            ? `将按命名结构选取最多 ${limit} 个代表文件名；生成后在全部 ${w.chosen.length} 个操作对象上本地试算。`
            : `本任务最多参考 ${limit} 个文件，请缩小范围。`}
        </p>
      )}
      <button
        className="primary ai-action"
        disabled={
          !w.desktop ||
          !w.eligibleAiCount ||
          (w.aiTask === 'names' && w.eligibleAiCount > limit) ||
          (w.aiTask === 'rules' && w.examples.some((e) => !e.expected.trim())) ||
          (w.route === 'local' && !w.model)
        }
        onClick={() => void w.prepareAi()}
      >
        <Sparkles size={14} />
        {w.aiTask === 'rules' ? '预览文件名并生成规则' : '查看内容并生成'}
      </button>
      {w.aiTask === 'rules' ? (
        <p className="form-note ai-safety-note">规则只加入预览，执行仍需单独确认。</p>
      ) : (
        <div className="ai-result">
          <div className="section-row">
            <h3>命名依据</h3>
            <span>选中文件查看</span>
          </div>
          <strong>{selectedFile?.name ?? '未选择文件'}</strong>
          <p>{selectedFile ? (w.reasons[selectedFile.id] ?? '未生成建议') : '—'}</p>
        </div>
      )}
    </div>
  );
}
