import { useEffect, useRef, useState } from 'react';
import type { Adjustments } from './engine';
import {
  capturePreset,
  exportPreset,
  exportXmp,
  importPreset,
  loadPresets,
  portraitPresets,
  presetValues,
  storePresets,
  type PresetKind,
  type UserPreset,
} from './preset-library';
import { saveFile } from './mobile';
import { createPresetToken, readPresetToken } from './preset-token';

const names = { portrait: '인물', color: '색감', combined: '인물 + 색감' };
export default function PresetLibrary({
  a,
  disabled,
  count,
  onApply,
  onSync,
}: {
  a: Adjustments;
  disabled: boolean;
  count: number;
  onApply: (values: Partial<Adjustments>) => void;
  onSync: (kind: PresetKind, starred: boolean) => void;
}) {
  const [library, setLibrary] = useState<UserPreset[]>([]),
    [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState('');
  const [name, setName] = useState(''),
    [kind, setKind] = useState<PresetKind>('combined');
  const [selected, setSelected] = useState(''),
    [amount, setAmount] = useState(100);
  const [filter, setFilter] = useState('all'),
    [starred, setStarred] = useState(false);
  const [token, setToken] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const all = [...portraitPresets, ...library];
  const chosen = all.find((p) => p.id === selected),
    own = library.find((p) => p.id === selected);
  useEffect(() => {
    let alive = true;
    void loadPresets()
      .then((data) => {
        if (alive) {
          setLibrary(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (alive) setFeedback('프리셋 보관함을 읽지 못했습니다. 앱을 다시 열어 주세요.');
      });
    return () => {
      alive = false;
    };
  }, []);
  async function persist(next: UserPreset[], message: string) {
    setSaving(true);
    try {
      await storePresets(next);
      setLibrary(next);
      setFeedback(message);
      return true;
    } catch (e) {
      setFeedback(`저장 실패: ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="preset-library" aria-label="사용자 프리셋 보관함">
      <h3>인물 · 나의 프리셋</h3>
      <label className="preset-field">
        종류 보기
        <select
          aria-label="프리셋 종류 보기"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">모두</option>
          {Object.entries(names).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="preset-field">
        적용 강도 <output>{amount}%</output>
        <input
          aria-label="프리셋 적용 강도"
          type="range"
          min="0"
          max="100"
          value={amount}
          onChange={(e) => setAmount(+e.target.value)}
        />
      </label>
      <p className="preset-note">강도를 정한 뒤 프리셋을 눌러 적용하세요.</p>
      <div className="user-preset-list">
        {all
          .filter((p) => filter === 'all' || p.kind === filter)
          .map((p) => (
            <button
              key={p.id}
              aria-pressed={selected === p.id}
              disabled={disabled || saving}
              onClick={() => {
                setSelected(p.id);
                setName(p.name);
                setKind(p.kind);
                onApply(presetValues(p, amount));
                setFeedback(`${p.name} · ${amount}% 적용`);
              }}
            >
              <span>
                {p.name}
                <small>
                  {names[p.kind]}
                  {library.some((v) => v.id === p.id) ? ' · 사용자' : ''}
                </small>
              </span>
            </button>
          ))}
      </div>
      {chosen?.warnings.length ? (
        <details className="preset-notice" open>
          <summary>가져온 프리셋 안내</summary>
          {chosen.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      ) : null}
      <details className="preset-manage">
        <summary>저장 · 가져오기 · 동기화</summary>
        <label className="preset-field">
          프리셋 이름
          <input
            aria-label="프리셋 이름"
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="preset-field">
          저장할 보정
          <select
            aria-label="저장할 보정"
            value={kind}
            onChange={(e) => setKind(e.target.value as PresetKind)}
          >
            {Object.entries(names).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || !loaded || saving || !name.trim()}
          onClick={() => {
            const preset: UserPreset = {
              id: crypto.randomUUID(),
              name: name.trim(),
              kind,
              values: capturePreset(a, kind),
              warnings: [],
            };
            void persist([...library, preset], '프리셋을 이 기기에 저장했습니다.').then((ok) => {
              if (ok) setSelected(preset.id);
            });
          }}
        >
          현재 보정을 새 프리셋으로 저장
        </button>
        <div className="preset-actions">
          <button
            disabled={!own || disabled || saving || !name.trim()}
            onClick={() => {
              if (own)
                void persist(
                  library.map((p) =>
                    p.id === own.id
                      ? {
                          ...p,
                          name: name.trim(),
                          kind,
                          values: capturePreset(a, kind),
                          warnings: [],
                        }
                      : p,
                  ),
                  '현재 보정으로 업데이트했습니다.',
                );
            }}
          >
            선택 프리셋 업데이트
          </button>
          <button
            disabled={!own || saving || !name.trim()}
            onClick={() => {
              if (own)
                void persist(
                  library.map((p) => (p.id === own.id ? { ...p, name: name.trim() } : p)),
                  '이름을 변경했습니다.',
                );
            }}
          >
            이름 변경
          </button>
          <button
            disabled={!own || saving}
            onClick={() => {
              if (own)
                void persist(
                  library.filter((p) => p.id !== own.id),
                  '프리셋을 삭제했습니다.',
                ).then((ok) => {
                  if (ok) setSelected('');
                });
            }}
          >
            선택 프리셋 삭제
          </button>
        </div>
        <button
          disabled={!chosen || saving}
          onClick={() => {
            if (chosen)
              void saveFile(
                new Blob([exportPreset(chosen)], { type: 'application/json' }),
                `${chosen.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.hinanapreset`,
              ).catch((e) => setFeedback((e as Error).message));
          }}
        >
          선택 프리셋 파일 내보내기
        </button>
        <button disabled={!loaded || saving} onClick={() => input.current?.click()}>
          프리셋 파일 가져오기
        </button>
        <button
          disabled={!chosen || chosen.kind === 'portrait' || saving}
          onClick={() => {
            if (!chosen) return;
            try {
              void saveFile(
                new Blob([exportXmp(chosen)], { type: 'application/rdf+xml' }),
                `${chosen.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')}.xmp`,
              ).catch((e) => setFeedback((e as Error).message));
              setFeedback('기본 색상·HSL만 XMP로 내보냅니다. 피부·LUT·곡선은 포함되지 않습니다.');
            } catch (e) {
              setFeedback((e as Error).message);
            }
          }}
        >
          색감 XMP로 내보내기
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".hinanapreset,.json,.xmp,.cube"
          aria-label="프리셋 파일"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            if (!files.length) return;
            setSaving(true);
            void (async () => {
              try {
                if (
                  files.length > 20 ||
                  files.some((f) => f.size > 24_000_000) ||
                  files.reduce((s, f) => s + f.size, 0) > 48_000_000
                )
                  throw Error('한 번에 20개, 파일당 24MB, 합계 48MB까지 가져올 수 있습니다.');
                const imported = await Promise.all(
                  files.map(async (file) => importPreset(await file.text(), file.name)),
                );
                const ok = await persist(
                  [...library, ...imported],
                  `${imported.length}개 프리셋을 가져왔습니다.${imported.some((p) => p.warnings.length) ? ' 적용 전 안내를 확인하세요.' : ''}`,
                );
                if (ok) {
                  setSelected(imported[0].id);
                  setName(imported[0].name);
                  setKind(imported[0].kind);
                }
              } catch (error) {
                setFeedback(`가져오기 실패: ${(error as Error).message}`);
              } finally {
                setSaving(false);
              }
            })();
          }}
        />
        <p className="preset-note">
          Hinana · XMP 기본 색상/HSL · 3D CUBE(sRGB) 지원. 이보토 공유 토큰·AI 설정은 지원하지
          않습니다.
        </p>
        <label className="preset-field">
          Hinana 공유 토큰
          <textarea
            aria-label="Hinana 공유 토큰"
            rows={3}
            maxLength={1500000}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button
          disabled={!chosen || saving}
          onClick={() => {
            if (!chosen) return;
            setSaving(true);
            void createPresetToken(chosen)
              .then((value) => {
                setToken(value);
                setFeedback(
                  '공유 토큰을 만들었습니다. 사진·인식 좌표 없이 프리셋 설정만 포함합니다.',
                );
              })
              .catch((e) => setFeedback((e as Error).message))
              .finally(() => setSaving(false));
          }}
        >
          선택 프리셋 토큰 만들기
        </button>
        <button
          disabled={!token || saving}
          onClick={() => {
            void navigator.clipboard
              .writeText(token)
              .then(() => setFeedback('토큰을 복사했습니다.'))
              .catch(() => setFeedback('토큰 입력란을 선택해 직접 복사해 주세요.'));
          }}
        >
          토큰 복사
        </button>
        <button
          disabled={!token || !loaded || saving}
          onClick={() => {
            setSaving(true);
            void readPresetToken(token)
              .then(async (preset) => {
                if (await persist([...library, preset], '공유 프리셋을 가져왔습니다.')) {
                  setSelected(preset.id);
                  setName(preset.name);
                  setKind(preset.kind);
                }
              })
              .catch((e) => setFeedback(`토큰 가져오기 실패: ${(e as Error).message}`))
              .finally(() => setSaving(false));
          }}
        >
          Hinana 토큰 가져오기
        </button>
        <p className="preset-note">
          토큰은 서버 없이 보정 설정을 담습니다. 받은 사람이 읽을 수 있으며 만료·회수되지 않습니다.
          큰 LUT는 파일로 공유하세요.
        </p>
        <label className="preset-check">
          <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} />
          별표 사진에만 동기화
        </label>
        <button disabled={disabled || count < 2 || saving} onClick={() => onSync(kind, starred)}>
          현재 {names[kind]} 보정을 다른 사진에 동기화
        </button>
        <p className="preset-note">
          크롭·리퀴파이·마스크는 사진별로 유지합니다. 각 사진에서 실행 취소할 수 있습니다.
        </p>
      </details>
      <p className="preset-feedback" role="status">
        {feedback}
      </p>
    </section>
  );
}
