import ColorPanel from './ColorPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Info,
  Camera,
  ScanFace,
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop,
  FolderOpen,
  Grid2X2,
  ImagePlus,
  Images,
  LoaderCircle,
  Maximize,
  PanelLeftClose,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  Thermometer,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  Keyboard,
  Palette,
  CheckCircle2,
} from 'lucide-react';
import {
  defaults,
  presets,
  renderPhoto,
  loadImage,
  readDataURL,
  histogram,
  outputSize,
  download,
  type Adjustments,
} from './engine';
import { appInfo } from './app-info';
import { preserveExif } from './exif-export';
import { readMetadata } from './metadata';
import { saveWorkspace, restoreWorkspace, validateProject, type Photo } from './storage';

const sections: {
  title: string;
  icon: typeof Sun;
  keys: {
    key: keyof Adjustments;
    name: string;
    min?: number;
    max?: number;
    step?: number;
    gradient?: string;
  }[];
}[] = [
  {
    title: '피부 보정',
    icon: ScanFace,
    keys: [
      { key: 'skinSmooth', name: '피부 부드럽게', min: 0 },
      { key: 'skinRedness', name: '붉은 기 완화', min: 0 },
      { key: 'skinBrightness', name: '피부 밝기', min: 0 },
    ],
  },
  {
    title: '빛',
    icon: Sun,
    keys: [
      { key: 'exposure', name: '노출', min: -3, max: 3, step: 0.05 },
      { key: 'contrast', name: '대비' },
      { key: 'highlights', name: '하이라이트' },
      { key: 'shadows', name: '그림자' },
      { key: 'whites', name: '흰색 계열' },
      { key: 'blacks', name: '검정 계열' },
    ],
  },
  {
    title: '색상',
    icon: Thermometer,
    keys: [
      { key: 'temperature', name: '색온도', gradient: 'linear-gradient(90deg,#5a92e5,#dfb567)' },
      { key: 'tint', name: '색조', gradient: 'linear-gradient(90deg,#7bb39a,#b77ca6)' },
      { key: 'vibrance', name: '생동감' },
      { key: 'saturation', name: '채도' },
    ],
  },
  {
    title: '효과',
    icon: Sparkles,
    keys: [
      { key: 'fade', name: '페이드', min: 0 },
      { key: 'vignette', name: '비네팅', min: 0 },
    ],
  },
];
function Hist({ bins }: { bins: number[][] }) {
  const max = Math.max(1, ...bins.flat());
  return (
    <svg viewBox="0 0 256 68" preserveAspectRatio="none" aria-label="RGB 히스토그램">
      {bins.map((b, c) => (
        <path
          key={c}
          d={`M0,68 ${b.map((v, i) => `L${(i * 256) / 63},${68 - (v / max) ** 0.6 * 62}`).join(' ')} L256,68 Z`}
          fill={['#db9578', '#9eb295', '#7e9cad'][c]}
          opacity=".48"
          style={{ mixBlendMode: 'screen' }}
        />
      ))}
    </svg>
  );
}
function App() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [keepExif, setKeepExif] = useState(true);
  const aboutClose = useRef<HTMLButtonElement>(null);
  const aboutTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!aboutOpen) return;
    aboutTrigger.current = document.activeElement as HTMLElement;
    aboutClose.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setAboutOpen(false);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        aboutClose.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      aboutTrigger.current?.focus();
    };
  }, [aboutOpen]);
  const [photos, setPhotos] = useState<Photo[]>([]),
    [selected, setSelected] = useState('');
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(''),
    [toast, setToast] = useState(''),
    [saveMessage, setSaveStatus] = useState('로컬 저장 준비');
  const [view, setView] = useState<'edit' | 'grid'>('edit'),
    [filter, setFilter] = useState<'all' | 'stars'>('all'),
    [query, setQuery] = useState('');
  const [bins, setBins] = useState<number[][]>([[], [], []]),
    [compare, setCompare] = useState(false),
    [zoom, setZoom] = useState(0),
    [cropOpen, setCropOpen] = useState(false),
    [leftOpen, setLeftOpen] = useState(true);
  const [tab, setTab] = useState<'edit' | 'color' | 'info'>('edit'),
    [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false);
  const [format, setFormat] = useState('jpeg'),
    [quality, setQuality] = useState(95),
    [exportSize, setExportSize] = useState('original');
  const canvas = useRef<HTMLCanvasElement>(null),
    input = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    imageCache = useRef(new Map<string, HTMLImageElement>()),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [savedSnapshot, setSavedSnapshot] = useState<{ photos: Photo[]; selected: string } | null>(
    null,
  );
  const saveStatus =
    saveMessage === '이 기기에 저장됨' &&
    (savedSnapshot?.photos !== photos || savedSnapshot?.selected !== selected)
      ? '저장 중…'
      : saveMessage;
  const active = photos.find((p) => p.id === selected),
    a = active?.adjustments || defaults;
  const visible = photos.filter(
    (p) => (filter === 'all' || p.rating > 0) && p.name.toLowerCase().includes(query.toLowerCase()),
  );
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);
  useEffect(() => {
    let cancelled = false;
    restoreWorkspace()
      .then((p) => {
        if (!cancelled && p) {
          setPhotos(p.photos);
          setSelected(p.selected);
        }
      })
      .catch(() => notify('로컬 저장소를 열지 못했습니다. 프로젝트 파일로 저장해 주세요.'))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);
  useEffect(() => {
    if (!ready) return;
    let obsolete = false;
    setSaveStatus('저장 중…');
    const timer = setTimeout(() => {
      saveWorkspace({ version: 1, photos, selected })
        .then(() => {
          if (!obsolete) {
            setSavedSnapshot({ photos, selected });
            setSaveStatus('이 기기에 저장됨');
          }
        })
        .catch(() => {
          if (obsolete) return;
          setSaveStatus('저장 실패');
          notify(
            '저장 공간이 부족하거나 저장소를 사용할 수 없습니다. 프로젝트 파일로 저장해 주세요.',
          );
        });
    }, 650);
    return () => {
      obsolete = true;
      clearTimeout(timer);
    };
  }, [photos, selected, ready, notify]);
  useEffect(() => {
    if (!active || view !== 'edit') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        let image = imageCache.current.get(active.id);
        if (!image) {
          image = await loadImage(active.src);
          imageCache.current.set(active.id, image);
        }
        if (cancelled || !canvas.current) return;
        const settings = compare
          ? { ...defaults, rotation: a.rotation, flip: a.flip, crop: a.crop }
          : a;
        const pixels = renderPhoto(image, canvas.current, settings, zoom ? Infinity : 1600);
        setBins(histogram(pixels.data));
      } catch (e) {
        notify((e as Error).message);
      }
    }, 16);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, a, compare, view, zoom, notify]);
  function change(values: Partial<Adjustments>, commit = false) {
    setPhotos((current) =>
      current.map((p) => {
        if (p.id !== selected) return p;
        const next = { ...p.adjustments, ...values };
        if (!commit) return { ...p, adjustments: next };
        if (JSON.stringify(p.history[p.cursor]) === JSON.stringify(next)) return p;
        const history = [...p.history.slice(0, p.cursor + 1), next].slice(-60);
        return { ...p, adjustments: next, history, cursor: history.length - 1 };
      }),
    );
  }
  function undo(direction: number) {
    setPhotos((current) =>
      current.map((p) => {
        if (p.id !== selected) return p;
        const cursor = Math.max(0, Math.min(p.history.length - 1, p.cursor + direction));
        return { ...p, cursor, adjustments: { ...p.history[cursor] } };
      }),
    );
  }
  function choose(id: string) {
    setSelected(id);
    setCompare(false);
    setZoom(0);
  }
  const rawPattern =
    /\.(dng|cr2|cr3|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|rwl|3fr|fff|iiq|srw|raw)$/i;
  async function importFiles(files: FileList | File[]) {
    if (busy) return;
    const projects = Array.from(files).filter((file) => /\.(hinanaimage|hinana)$/i.test(file.name));
    if (projects.length) {
      if (files.length !== 1) {
        notify('프로젝트 파일은 한 번에 하나씩 열어 주세요.');
        return;
      }
      await openProject(projects[0]);
      return;
    }
    setBusy('사진 불러오는 중');
    const added: Photo[] = [];
    let failed = 0;
    let lastError = '';
    try {
      for (const file of Array.from(files)) {
        try {
          if (photos.length + added.length >= 200) throw new Error();
          const isRaw = rawPattern.test(file.name);
          if (!isRaw && !/\.(jpe?g|png|webp)$/i.test(file.name))
            throw new Error('지원하지 않는 파일 형식입니다.');
          if (file.size > (isRaw ? 120 : 80) * 1024 * 1024)
            throw new Error(
              isRaw ? 'RAW는 120MB 이하만 지원합니다.' : '사진은 80MB 이하만 지원합니다.',
            );
          let src: string, rawSource: string | undefined;
          if (isRaw) {
            if (!window.hinana) throw new Error('RAW는 데스크톱 앱에서 불러올 수 있습니다.');
            setBusy(`RAW 현상 중 · ${file.name}`);
            const decoded = await window.hinana.decodeRaw(file);
            src = decoded.src;
            rawSource = decoded.original;
          } else src = await readDataURL(file);
          const image = await loadImage(src);
          if (image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error();
          const photo: Photo = {
            id: crypto.randomUUID(),
            name: file.name,
            src,
            width: image.naturalWidth,
            height: image.naturalHeight,
            rating: 0,
            metadata: await readMetadata(src),
            ...(rawSource ? { rawSource } : {}),
            adjustments: { ...defaults },
            history: [{ ...defaults }],
            cursor: 0,
          };
          imageCache.current.set(photo.id, image);
          added.push(photo);
        } catch (error) {
          lastError = (error as Error).message.replace(
            /^Error invoking remote method '[^']+': Error: /,
            '',
          );
          failed++;
        }
      }
      setPhotos((p) => [...p, ...added]);
      if (added.length) {
        setQuery('');
        setFilter('all');
        choose(added[0].id);
        setView('edit');
      }
      notify(
        `${added.length}장의 사진을 불러왔습니다.${failed ? ` ${failed}개 실패: ${lastError || '60MP / 최대 200장 제한을 확인해 주세요.'}` : ''}`,
      );
    } finally {
      setBusy('');
    }
  }
  async function sample() {
    setBusy('샘플 준비 중');
    try {
      const image = await loadImage('./samples/alpine.jpg');
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = image.naturalWidth;
      sampleCanvas.height = image.naturalHeight;
      sampleCanvas.getContext('2d')!.drawImage(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        sampleCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('샘플 변환 실패'))),
          'image/jpeg',
          0.95,
        ),
      );
      const file = new File([blob], 'Alpine — 산의 초상.jpg', {
        type: 'image/jpeg',
      });
      setBusy('');
      await importFiles([file]);
    } catch {
      notify('샘플을 불러오지 못했습니다. 사진을 직접 추가해 주세요.');
    } finally {
      setBusy('');
    }
  }
  function rate(value: number) {
    setPhotos((p) =>
      p.map((photo) => (photo.id === selected ? { ...photo, rating: value } : photo)),
    );
  }
  function remove() {
    if (
      !active ||
      !window.confirm(`“${active.name}”을 작업 공간에서 제거할까요? 원본 파일은 유지됩니다.`)
    )
      return;
    imageCache.current.delete(active.id);
    const remaining = photos.filter((p) => p.id !== active.id);
    setPhotos(remaining);
    choose(remaining[0]?.id || '');
  }
  async function saveProject() {
    setBusy('프로젝트 저장 중');
    try {
      download(
        new Blob([JSON.stringify({ version: 1, photos, selected })], { type: 'application/json' }),
        'Hinana-Workspace.hinanaimage',
      );
      notify('원본과 보정값을 포함한 프로젝트를 저장했습니다.');
    } catch {
      notify('프로젝트를 저장하지 못했습니다.');
    } finally {
      setBusy('');
    }
  }
  async function openProject(file?: File) {
    if (!file) return;
    setBusy('프로젝트 여는 중');
    try {
      if (file.size > 512 * 1024 * 1024) throw new Error('512MB 이하의 프로젝트만 열 수 있습니다.');
      const project = validateProject(JSON.parse(await file.text()));
      for (const p of project.photos) {
        const img = await loadImage(p.src);
        if (img.naturalWidth * img.naturalHeight > 60_000_000)
          throw new Error('60MP 이하의 사진만 지원합니다.');
        p.metadata = await readMetadata(p.src);
        p.width = img.naturalWidth;
        p.height = img.naturalHeight;
      }
      if (
        photos.length &&
        !window.confirm(
          '현재 작업 공간을 이 프로젝트로 바꿀까요? 필요한 경우 먼저 프로젝트를 저장해 주세요.',
        )
      )
        return;
      imageCache.current.clear();
      setPhotos(project.photos);
      choose(project.selected);
      setQuery('');
      setFilter('all');
      setView('edit');
      notify('프로젝트를 열었습니다.');
    } catch (e) {
      notify(`프로젝트 열기 실패: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  async function exportPhoto() {
    if (!active) return;
    setBusy('원본 해상도로 렌더링 중');
    await new Promise((r) => setTimeout(r, 50));
    try {
      const img = imageCache.current.get(active.id) || (await loadImage(active.src)),
        target = document.createElement('canvas');
      renderPhoto(
        img,
        target,
        active.adjustments,
        exportSize === 'original' ? Infinity : Number(exportSize),
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        target.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('이미지 변환 실패'))),
          `image/${format}`,
          quality / 100,
        ),
      );
      const exported = keepExif
        ? await preserveExif(blob, active.src, target.width, target.height)
        : blob;
      download(
        exported,
        `${active.name.replace(/\.[^.]+$/, '')}-edited.${format === 'jpeg' ? 'jpg' : format}`,
      );
      setExportOpen(false);
      notify(`${target.width} × ${target.height} 이미지가 내보내졌습니다.`);
      target.width = target.height = 0;
    } catch (e) {
      notify(`내보내기 실패: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  }
  const keyboardActions = useRef({ undo, rate, choose, saveProject, active, photos, selected });
  keyboardActions.current = { undo, rate, choose, saveProject, active, photos, selected };
  useEffect(
    () =>
      window.hinana?.onMenuAction((action) => {
        if (action === 'about') {
          setAboutOpen(true);
          return;
        }
        if (action === 'project-open' || action === 'project-save') {
          if (busy || !ready || exportOpen || helpOpen || aboutOpen) return;
          if (action === 'project-open') projectInput.current?.click();
          else void keyboardActions.current.saveProject();
          return;
        }
        const element = document.activeElement as HTMLElement | null;
        if (element?.matches('input:not([type=range]), textarea')) {
          document.execCommand(action);
          return;
        }
        if (!exportOpen && !helpOpen && !aboutOpen && !busy)
          keyboardActions.current.undo(action === 'undo' ? -1 : 1);
      }),
    [exportOpen, helpOpen, aboutOpen, busy, ready],
  );
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).matches('input, select, textarea') ||
        exportOpen ||
        helpOpen ||
        aboutOpen ||
        busy
      )
        return;
      const k = keyboardActions.current;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        k.undo(e.shiftKey ? 1 : -1);
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        if (e.shiftKey) projectInput.current?.click();
        else input.current?.click();
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void k.saveProject();
      } else if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (k.active) setExportOpen(true);
      } else if (e.key === '\\') setCompare((v) => !v);
      else if (/^[0-5]$/.test(e.key)) k.rate(Number(e.key));
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const index = k.photos.findIndex((p) => p.id === k.selected),
          next = k.photos[index + (e.key === 'ArrowRight' ? 1 : -1)];
        if (next) k.choose(next.id);
      } else if (e.key === 'Escape') {
        setCompare(false);
        setCropOpen(false);
      }
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [exportOpen, helpOpen, aboutOpen, busy]);
  const changed = JSON.stringify(a) !== JSON.stringify(defaults);
  const dimensions = active ? outputSize(active.width, active.height, a) : [0, 0];
  return (
    <div
      className={`app ${leftOpen ? '' : 'hide-left'} ${window.hinana ? `desktop-${window.hinana.platform}` : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && ready) void importFiles(e.dataTransfer.files);
      }}
    >
      <input
        hidden
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,.dng,.cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.raf,.orf,.rw2,.pef,.rwl,.3fr,.fff,.iiq,.srw,.raw"
        multiple
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".hinanaimage,.hinana"
        data-testid="project-file-input"
        onChange={(e) => {
          void openProject(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <img
              className="header-app-icon"
              src="./app-icon.png"
              alt="Hinana Studio Image 아이콘"
            />
          </div>
          <div>
            HINANA <span>STUDIO IMAGE</span>
          </div>
          <small>β</small>
        </div>
        <nav aria-label="작업 모드">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            라이브러리
          </button>
          <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>
            현상
          </button>
        </nav>
        <div className="top-actions">
          <button
            className="project-open-button"
            aria-label="프로젝트 열기"
            title="프로젝트 열기 (⌘/Ctrl Shift O)"
            disabled={!!busy || !ready}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={16} /> 프로젝트 열기
          </button>
          <button
            className="icon-button"
            title="프로그램 정보"
            aria-label="프로그램 정보"
            onClick={() => setAboutOpen(true)}
          >
            <Info size={17} />
          </button>
          <span className="save-status">
            <span />
            {saveStatus}
          </span>
          <button
            className="icon-button"
            title="프로젝트 저장 (⌘/Ctrl S)"
            disabled={busy !== '' || !ready}
            onClick={saveProject}
          >
            <Save size={17} />
          </button>
          <button
            className="export-button"
            disabled={!active || !!busy}
            onClick={() => setExportOpen(true)}
          >
            <ArrowDownToLine size={15} /> 내보내기
          </button>
        </div>
      </header>
      <aside className="left-panel">
        <div className="workspace-title">
          작업 공간 <span>LOCAL</span>
        </div>
        <button
          className="import-button"
          disabled={!!busy || !ready}
          onClick={() => input.current?.click()}
        >
          <Plus size={17} /> 사진 추가{' '}
          <kbd>{window.hinana?.platform === 'darwin' ? '⌘ O' : 'Ctrl O'}</kbd>
        </button>
        <div className="library-nav">
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>
            <Images size={16} /> 모든 사진 <span>{photos.length.toString().padStart(2, '0')}</span>
          </button>
          <button
            className={filter === 'stars' ? 'selected' : ''}
            onClick={() => setFilter('stars')}
          >
            <Star size={16} /> 별표 표시{' '}
            <span>
              {photos
                .filter((p) => p.rating > 0)
                .length.toString()
                .padStart(2, '0')}
            </span>
          </button>
        </div>
        <div className="side-divider" />
        <div className="section-caption">
          컬렉션{' '}
          <button
            title="프로젝트 열기"
            disabled={!!busy}
            onClick={() => projectInput.current?.click()}
          >
            <FolderOpen size={14} />
          </button>
        </div>
        <button
          className="collection"
          disabled={!!busy}
          onClick={() => projectInput.current?.click()}
        >
          <FolderOpen size={15} /> 프로젝트 열기 <ChevronRight size={13} />
        </button>
        <div className="side-divider" />
        <div className="section-caption">
          크리에이티브 프리셋 <span>{presets.length}</span>
        </div>
        <p className="muted side-description">한 번의 터치로 새로운 분위기</p>
        <div className="preset-list">
          {presets.map((p) => (
            <button
              key={p.id}
              disabled={!active}
              onClick={() => {
                change(
                  {
                    ...defaults,
                    ...p.values,
                    skinSmooth: a.skinSmooth,
                    skinRedness: a.skinRedness,
                    skinBrightness: a.skinBrightness,
                    crop: a.crop,
                    rotation: a.rotation,
                    flip: a.flip,
                  },
                  true,
                );
                setCompare(false);
              }}
            >
              <span
                className="preset-swatch"
                style={{
                  background: `linear-gradient(145deg, ${p.color}bb, ${p.color}44), url('./samples/alpine.jpg') center/cover`,
                }}
              />
              <span>
                {p.name}
                <small>{p.description}</small>
              </span>
              <ChevronRight size={12} />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-badge">
            <span />
            당신의 사진은 이 기기에만
          </div>
          <p>원본은 그대로, 가능성은 무한하게.</p>
          <button onClick={() => setHelpOpen(true)}>
            <Keyboard size={14} /> 단축키 안내 <span>?</span>
          </button>
          <span className="version">
            HINANA STUDIO IMAGE <span>v{appInfo.version}</span>
          </span>
        </div>
      </aside>
      <main className="main-panel">
        <div className="main-toolbar">
          <div>
            <button
              className="icon-button"
              title="사이드바 표시/숨기기"
              onClick={() => setLeftOpen((v) => !v)}
            >
              <PanelLeftClose size={16} />
            </button>
            <span className="toolbar-divider" />
            <span>{view === 'edit' ? '현상 작업실' : '사진 라이브러리'}</span>
            <ChevronRight size={13} />
            <span className="muted">{filter === 'all' ? '모든 사진' : '별표 표시'}</span>
          </div>
          <div>
            <span className="photo-count">{photos.length}장의 사진</span>
            <button
              className={`icon-button ${view === 'grid' ? 'on' : ''}`}
              title="격자 보기"
              onClick={() => setView((v) => (v === 'grid' ? 'edit' : 'grid'))}
            >
              <Grid2X2 size={16} />
            </button>
          </div>
        </div>
        {view === 'grid' ? (
          <div className="grid-view">
            <div className="grid-heading">
              <div>
                <span className="eyebrow">YOUR PERSPECTIVE</span>
                <h1>순간을 모으다.</h1>
                <p>사진을 선택하고 나만의 시선으로 완성해 보세요.</p>
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="사진 검색"
                  placeholder="사진 검색"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <div className="photo-grid">
              {visible.map((p) => (
                <button
                  className={p.id === selected ? 'selected' : ''}
                  key={p.id}
                  onClick={() => {
                    choose(p.id);
                    setView('edit');
                  }}
                >
                  <img src={p.src} alt={p.name} />
                  <span>{p.name}</span>
                  <small>
                    {p.width} × {p.height} <span>{'★'.repeat(p.rating)}</span>
                  </small>
                </button>
              ))}
            </div>
            {visible.length === 0 && (
              <div className="grid-empty">
                {photos.length
                  ? '조건에 맞는 사진이 없습니다.'
                  : '아직 사진이 없습니다. 사진을 추가해 보세요.'}
              </div>
            )}
          </div>
        ) : active ? (
          <>
            <div className="photo-heading">
              <div>
                <h1>{active.name.replace(/\.[^.]+$/, '')}</h1>
                <span>
                  {active.name.split('.').pop()?.toUpperCase()} <i /> {active.width} ×{' '}
                  {active.height} <i /> 비파괴 편집
                </span>
              </div>
              <div className="edit-badge">
                {compare ? '원본 보기' : changed ? '보정됨' : '원본'}
                {changed && !compare && <span />}
              </div>
            </div>
            <div className={`canvas-area ${zoom ? 'zoomed' : ''}`}>
              <div
                className="canvas-holder"
                style={zoom ? { width: `${(dimensions[0] * zoom) / 100}px`, flexShrink: 0 } : {}}
              >
                <canvas ref={canvas} aria-label="보정 사진 미리보기" />
                {compare && <span className="before-label">BEFORE · 원본</span>}
                {cropOpen && (
                  <div className="crop-grid">
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            </div>
            <div className="viewer-toolbar">
              <div>
                <button
                  className={`tool ${cropOpen ? 'on' : ''}`}
                  onClick={() => setCropOpen((v) => !v)}
                  title="가운데 기준 비율 자르기"
                >
                  <Crop size={16} />
                  <span>자르기</span>
                </button>
                <button
                  className="icon-button"
                  title="오른쪽으로 90° 회전"
                  onClick={() => change({ rotation: (a.rotation + 90) % 360 }, true)}
                >
                  <RotateCw size={16} />
                </button>
                <button
                  className="icon-button"
                  title="좌우 반전"
                  onClick={() => change({ flip: !a.flip }, true)}
                >
                  <ArrowLeftRight size={16} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className="icon-button"
                  title="실행 취소 (⌘/Ctrl Z)"
                  disabled={!active.cursor}
                  onClick={() => undo(-1)}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  className="icon-button"
                  title="다시 실행 (⌘/Ctrl Shift Z)"
                  disabled={active.cursor === active.history.length - 1}
                  onClick={() => undo(1)}
                >
                  <Redo2 size={16} />
                </button>
              </div>
              <div>
                <button
                  className={`tool ${compare ? 'on' : ''}`}
                  title="원본 비교 (\)"
                  onClick={() => setCompare((v) => !v)}
                >
                  <ArrowLeftRight size={15} />
                  <span>원본 비교</span>
                </button>
                <span className="toolbar-divider" />
                <button className="icon-button" title="화면에 맞추기" onClick={() => setZoom(0)}>
                  <Maximize size={15} />
                </button>
                <select
                  aria-label="미리보기 배율"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  <option value={0}>맞춤</option>
                  <option value={50}>50%</option>
                  <option value={100}>100%</option>
                  <option value={150}>150%</option>
                </select>
                <ZoomIn size={15} />
              </div>
            </div>
            {cropOpen && (
              <div className="crop-bar">
                <span>가운데 기준 자르기</span>
                {['original', '1:1', '4:5', '3:2', '16:9'].map((r) => (
                  <button
                    key={r}
                    className={a.crop === r ? 'active' : ''}
                    onClick={() => change({ crop: r }, true)}
                  >
                    {r === 'original' ? '원본' : r}
                  </button>
                ))}
                <button
                  className="icon-button"
                  title="자르기 닫기"
                  onClick={() => setCropOpen(false)}
                >
                  <Check size={15} />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="welcome">
            <div className="welcome-art">
              <img src="./samples/alpine.jpg" alt="산과 구름 샘플" />
              <div />
              <span>A NEW PERSPECTIVE</span>
            </div>
            <div className="welcome-content">
              <span className="eyebrow">HINANA STUDIO IMAGE</span>
              <h1>
                당신의 시선으로,
                <br />
                다시 피어나는 순간.
              </h1>
              <p>
                빛을 다듬고, 색을 발견하세요.
                <br />
                사진 한 장에서 시작되는 나만의 작업실.
              </p>
              <button
                className="primary"
                disabled={!!busy || !ready}
                onClick={() => input.current?.click()}
              >
                <ImagePlus size={17} /> 첫 사진 불러오기
              </button>
              <button className="sample-button" disabled={!!busy || !ready} onClick={sample}>
                샘플 사진으로 둘러보기 <ChevronRight size={15} />
              </button>
              <small>JPG, PNG, WebP, RAW · 사진을 이곳에 드래그하세요</small>
            </div>
          </div>
        )}
        <div className="filmstrip">
          <div className="filmstrip-header">
            <span>
              {filter === 'all' ? '모든 사진' : '별표 표시'} <b>{visible.length}</b>
            </span>
            <div>
              {active && (
                <>
                  <span className="rating">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        title={`${n}점 별표`}
                        onClick={() => rate(active.rating === n ? 0 : n)}
                      >
                        <Star size={13} fill={active.rating >= n ? 'currentColor' : 'none'} />
                      </button>
                    ))}
                  </span>
                  <span className="toolbar-divider" />
                  <button className="icon-button" title="선택 사진 제거" onClick={remove}>
                    <Trash2 size={13} />
                  </button>
                </>
              )}
              <button
                className="icon-button"
                title="이전 사진"
                disabled={photos.findIndex((p) => p.id === selected) <= 0}
                onClick={() => choose(photos[photos.findIndex((p) => p.id === selected) - 1].id)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="icon-button"
                title="다음 사진"
                disabled={
                  !active || photos.findIndex((p) => p.id === selected) >= photos.length - 1
                }
                onClick={() => choose(photos[photos.findIndex((p) => p.id === selected) + 1].id)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div className="filmstrip-items">
            {visible.map((p, i) => (
              <button
                key={p.id}
                className={`film-frame ${p.id === selected ? 'selected' : ''}`}
                onClick={() => {
                  choose(p.id);
                  setView('edit');
                }}
              >
                <img src={p.src} alt={p.name} />
                <span>{String(i + 1).padStart(2, '0')}</span>
                {p.rating > 0 && <small>★ {p.rating}</small>}
                {JSON.stringify(p.adjustments) !== JSON.stringify(defaults) && <i />}
              </button>
            ))}
            <button
              className="add-frame"
              title="사진 추가"
              disabled={!!busy || !ready}
              onClick={() => input.current?.click()}
            >
              <Plus size={22} />
              <span>사진 추가</span>
            </button>
          </div>
        </div>
      </main>
      <aside className="right-panel">
        <div className="histogram">
          <div className="section-caption">
            히스토그램 <span>RGB</span>
          </div>
          <Hist bins={bins} />
          <div className="histogram-labels">
            <span>0</span>
            <span>{active ? `${((active.width * active.height) / 1e6).toFixed(1)} MP` : '—'}</span>
            <span>255</span>
          </div>
        </div>
        <div className="adjust-tabs">
          <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>
            <SlidersHorizontal size={15} /> 편집
          </button>
          <button className={tab === 'color' ? 'active' : ''} onClick={() => setTab('color')}>
            <Palette size={15} /> 색상·톤
          </button>
          <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
            <Camera size={15} /> 정보
          </button>
        </div>
        <div className="adjust-scroll" key={tab}>
          {tab === 'info' ? (
            <section className="metadata-panel" aria-label="사진 EXIF 정보">
              <span className="eyebrow">PHOTO INFORMATION</span>
              <h2>사진의 기록</h2>
              {!active ? (
                <p>사진을 선택하면 촬영 정보를 볼 수 있습니다.</p>
              ) : (
                <>
                  <dl>
                    <div>
                      <dt>파일명</dt>
                      <dd>{active.name}</dd>
                    </div>
                    <div>
                      <dt>이미지 크기</dt>
                      <dd>
                        {active.width} × {active.height} px
                      </dd>
                    </div>
                  </dl>
                  {active.rawSource && (
                    <div className="raw-info">
                      <strong>RAW · 전체 해상도 현상</strong>
                      <p>
                        RAW 엔진으로 현상한 sRGB 작업 이미지입니다. RAW 원본은 프로젝트에 함께
                        보관됩니다.
                      </p>
                    </div>
                  )}
                  <h3>EXIF 촬영 정보</h3>
                  {active.metadata?.status === 'ready' ? (
                    <dl>
                      {active.metadata.fields.map((field) => (
                        <div key={field.label}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p>
                      {active.metadata?.status === 'error'
                        ? '메타데이터를 읽지 못했습니다. 사진 편집은 계속할 수 있습니다.'
                        : '이 사진에는 표시할 EXIF 촬영 정보가 없습니다.'}
                    </p>
                  )}
                  <p className="metadata-note">
                    원본에 기록된 정보입니다. 내보내기에서 EXIF 보존을 선택하면 촬영 정보도 함께
                    저장됩니다.
                  </p>
                </>
              )}
            </section>
          ) : tab === 'edit' ? (
            <>
              <div className="profile-row">
                <span>프로파일</span>
                <span>Hinana Color</span>
              </div>
              {sections.map((section) => (
                <details key={section.title} open>
                  <summary>
                    <section.icon size={15} />
                    {section.title}
                    <ChevronDown size={13} />
                  </summary>
                  {section.title === '피부 보정' && (
                    <p className="skin-note">
                      피부색 영역을 자동 선택해 보정합니다. 얼굴 인식 방식이 아니므로 비슷한 색의
                      배경에도 적용될 수 있습니다.
                    </p>
                  )}
                  <div className="sliders">
                    {section.keys.map((control) => (
                      <label className="slider-control" key={control.key}>
                        <span>
                          {control.name}
                          <output>
                            {Number(a[control.key]) > 0 ? '+' : ''}
                            {control.key === 'exposure'
                              ? Number(a[control.key]).toFixed(2)
                              : a[control.key]}
                          </output>
                        </span>
                        <input
                          aria-label={control.name}
                          disabled={!active || compare}
                          type="range"
                          min={control.min ?? -100}
                          max={control.max ?? 100}
                          step={control.step ?? 1}
                          value={Number(a[control.key])}
                          style={control.gradient ? { background: control.gradient } : {}}
                          onChange={(e) => change({ [control.key]: Number(e.target.value) })}
                          onPointerUp={() => change({}, true)}
                          onKeyUp={() => change({}, true)}
                          onBlur={() => change({}, true)}
                          onDoubleClick={() =>
                            change({ [control.key]: defaults[control.key] }, true)
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
              ))}
              <div className="adjust-note">
                <span />
                슬라이더를 두 번 클릭하면 초기화됩니다.
              </div>
            </>
          ) : (
            <ColorPanel adjustments={a} disabled={!active || compare} onChange={change} />
          )}
        </div>
        <div className="adjust-footer">
          <button
            disabled={!active || !changed}
            onClick={() => {
              change({ ...defaults }, true);
              setCompare(false);
            }}
          >
            <RotateCcw size={14} /> 모든 보정 초기화
          </button>
          <span>원본 파일은 변경되지 않습니다.</span>
        </div>
      </aside>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />{' '}
          {busy || (ready ? '작업 준비 완료' : '작업 공간 복원 중…')}
        </span>
        <span>
          {active ? `${dimensions[0]} × ${dimensions[1]} px` : '당신의 일상에, 새로운 색을.'}
          <span className="status-separator">|</span> 로컬 작업 공간{' '}
          <span className="status-separator">|</span> HINANA
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
          <button title="알림 닫기" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle className="spin" size={17} />
          {busy}
        </div>
      )}
      {exportOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) setExportOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-top">
              <div className="modal-icon">
                <ArrowDownToLine size={23} />
              </div>
              <button
                className="icon-button"
                disabled={!!busy}
                title="닫기"
                onClick={() => setExportOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <span className="eyebrow">THE FINISHING TOUCH</span>
            <h2 id="export-title">당신의 순간을 내보내세요.</h2>
            <p>보정이 적용된 새로운 이미지로 저장합니다.</p>
            <label>
              파일 형식
              <select
                aria-label="파일 형식"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="jpeg">JPEG · 작은 용량, 높은 호환성</option>
                <option value="png">PNG · 무손실 압축</option>
                <option value="webp">WebP · 효율적인 압축</option>
              </select>
            </label>
            <label>
              이미지 크기
              <select
                aria-label="이미지 크기"
                value={exportSize}
                onChange={(e) => setExportSize(e.target.value)}
              >
                <option value="original">
                  원본 해상도 · {dimensions[0]} × {dimensions[1]}
                </option>
                <option value="2560">긴 변 최대 2560px</option>
                <option value="1920">긴 변 최대 1920px</option>
                <option value="1080">긴 변 최대 1080px</option>
              </select>
            </label>
            {format !== 'png' && (
              <label>
                이미지 품질 <output>{quality}%</output>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
              </label>
            )}
            <label className="exif-option">
              <input
                type="checkbox"
                checked={keepExif}
                onChange={(e) => setKeepExif(e.target.checked)}
              />{' '}
              EXIF 메타데이터 보존
            </label>
            <div className="export-note">
              {keepExif
                ? '촬영 정보·GPS 등 원본 EXIF 유지 · 방향과 크기는 보정 결과에 맞게 갱신'
                : 'EXIF를 제외하고 저장'}
              <br />
              sRGB · 원본 파일 유지
            </div>
            <button className="primary" disabled={!!busy} onClick={exportPhoto}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowDownToLine size={16} />}{' '}
              이미지 저장
            </button>
          </section>
        </div>
      )}
      {aboutOpen && (
        <div className="modal-backdrop about-backdrop" onClick={() => setAboutOpen(false)}>
          <section
            className="modal about-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={aboutClose}
              className="icon-button about-close"
              title="프로그램 정보 닫기"
              onClick={() => setAboutOpen(false)}
            >
              <X size={20} />
            </button>
            <img className="about-icon" src="./app-icon.png" alt="Hinana Studio Image 앱 아이콘" />
            <h2 id="about-title">HINANA STUDIO IMAGE</h2>
            <p>당신의 시선으로 빛과 색을 다듬는 사진 작업실</p>
            <dl className="about-details">
              <div>
                <dt>프로그램 명</dt>
                <dd>{appInfo.name}</dd>
              </div>
              <div>
                <dt>개발/제작자</dt>
                <dd>{appInfo.creator}</dd>
              </div>
              <div>
                <dt>버전</dt>
                <dd>Ver. {appInfo.version}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            className="modal help-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-top">
              <Keyboard size={26} />
              <button className="icon-button" title="닫기" onClick={() => setHelpOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <h2 id="help-title">손끝에서 더 빠르게.</h2>
            {[
              ['사진 불러오기', '⌘ / Ctrl + O'],
              ['프로젝트 열기', '⌘ / Ctrl + Shift + O'],
              ['프로젝트 저장', '⌘ / Ctrl + S'],
              ['이미지 내보내기', '⌘ / Ctrl + E'],
              ['실행 취소', '⌘ / Ctrl + Z'],
              ['다시 실행', '⌘ / Ctrl + Shift + Z'],
              ['원본 비교', '\\'],
              ['별점 지정 / 해제', '1–5 / 0'],
              ['이전 / 다음 사진', '← / →'],
            ].map(([name, key]) => (
              <div className="shortcut" key={name}>
                <span>{name}</span>
                <kbd>{key}</kbd>
              </div>
            ))}
            <p>
              프로젝트는 원본 사진과 보정값을 함께 담습니다.
              <br />
              RAW는 각 운영체제의 현상 엔진에서 지원하는 카메라에 한해 처리합니다. 부분 마스크는
              아직 지원하지 않습니다.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
export default App;
