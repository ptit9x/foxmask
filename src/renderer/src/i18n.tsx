import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Minimal i18n: flat key dictionary for en/vi, a provider with the language
 * plus the beginner-tips visibility, and a tiny `t(key, params)` helper.
 * The language persists in localStorage and defaults from navigator.language.
 */

export type Lang = 'en' | 'vi'

const en = {
  'nav.profiles': 'Profiles',
  'nav.settings': 'Settings',

  'toolbar.search': 'Search profiles…',
  'toolbar.allGroups': 'All groups',
  'toolbar.import': 'Import',
  'toolbar.export': 'Export',
  'toolbar.bulkCreate': 'Bulk create',
  'toolbar.create': 'Create profile',

  'profiles.empty.title': 'No profiles yet.',
  'profiles.loading': 'Loading profiles…',
  'profiles.errorPrefix': 'Failed to load profiles:',
  'profiles.retry': 'Retry',
  'profiles.prev': '‹ Prev',
  'profiles.next': 'Next ›',
  'profiles.pagination': 'Page {page} / {last} · {total} profiles',
  'profiles.deleteConfirm': 'Delete profile "{name}"? This cannot be undone.',
  'profiles.imported': 'Imported {count}',
  'profiles.skipped': ', skipped {count}',

  'table.status': 'Status',
  'table.name': 'Name',
  'table.group': 'Group',
  'table.tags': 'Tags',
  'table.os': 'OS',
  'table.proxy': 'Proxy',
  'table.created': 'Created',
  'table.actions': 'Actions',
  'table.running': 'Running',
  'table.stopped': 'Stopped',
  'table.launch': 'Launch',
  'table.starting': 'Starting…',
  'table.stop': 'Stop',
  'table.edit': 'Edit',
  'table.duplicate': 'Duplicate',
  'table.delete': 'Delete',
  'table.direct': 'direct',

  'wizard.title.create': 'Create profile',
  'wizard.title.edit': 'Edit "{name}"',
  'wizard.step.basics': 'Basics',
  'wizard.step.fingerprint': 'Fingerprint',
  'wizard.step.proxy': 'Proxy',
  'wizard.step.review': 'Review',
  'wizard.name': 'Name *',
  'wizard.namePlaceholder': 'e.g. Shop Alpha',
  'wizard.group': 'Group',
  'wizard.tags': 'Tags (comma separated)',
  'wizard.tagsPlaceholder': 'shop, vip',
  'wizard.note': 'Note',
  'wizard.startupUrls': 'Startup URLs (one per line)',
  'wizard.os': 'Operating system',
  'wizard.regenerate': '↻ Regenerate',
  'wizard.previewWaiting': 'Generating preview…',
  'wizard.ua': 'User-Agent',
  'wizard.screen': 'Screen',
  'wizard.gpu': 'GPU',
  'wizard.timezone': 'Timezone',
  'wizard.cores': 'Cores / RAM',
  'wizard.reviewFingerprint': 'Fingerprint',
  'wizard.reviewProxy': 'Proxy',
  'wizard.cancel': 'Cancel',
  'wizard.back': '‹ Back',
  'wizard.next': 'Next ›',
  'wizard.save': 'Save changes',
  'wizard.create': 'Create profile',
  'wizard.saving': 'Saving…',
  'wizard.notFound': 'profile not found',

  'proxy.placeholder': 'socks5://user:pass@host:port — leave empty for direct',
  'proxy.test': 'Test',
  'proxy.testing': 'Testing…',

  'bulk.title': 'Bulk create profiles',
  'bulk.prefix': 'Name prefix',
  'bulk.count': 'Count (1–100)',
  'bulk.group': 'Group',
  'bulk.os': 'OS',
  'bulk.sharedProxy': 'Shared proxy (optional)',
  'bulk.creating': 'Creating… {done}/{count}',
  'bulk.create': 'Create {count} profiles',

  'settings.title': 'Settings',
  'settings.loading': 'Loading settings…',
  'settings.apiPort': 'API port',
  'settings.apiPortEffective': 'applies after restart; effective: {port}',
  'settings.dataDir': 'Data directory (empty = default)',
  'settings.chromium': 'Chromium executable (empty = managed download)',
  'settings.launchAtLogin': 'Launch Foxmask at login',
  'settings.save': 'Save settings',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved ✓',

  'tips.hide': 'Hide tips',
  'tips.show': 'Show tips',

  'tip.profiles': 'Each profile is a separate browser with its own fingerprint, cookies and proxy — sites cannot link them together. Create one, then press Launch to open it.',
  'tip.search': 'Search by name; the list updates as you type. The group filter narrows it further.',
  'tip.launch': 'Green dot = browser is running. Launch opens a Chromium window with this profile\'s fingerprint and proxy.',
  'tip.wizard.basics': 'Pick a name you will recognise later. Group and tags are just labels for filtering.',
  'tip.wizard.fingerprint': 'The fingerprint makes each profile look like a different physical device. Not happy with it? Press Regenerate.',
  'tip.wizard.proxy': 'Optional: paste a proxy so this profile browses from another IP. Press Test to verify it works before saving.',
  'tip.bulk': 'Need many profiles at once? Bulk create generates N unique-fingerprint profiles sharing one group and proxy.',
  'tip.importExport': 'Export saves all profiles to a JSON file (backup / move to another machine). Import restores them.',
  'tip.settings': 'These options are for advanced use — defaults are fine for most people. API port is where automation tools connect.'
}

const vi: typeof en = {
  'nav.profiles': 'Hồ sơ',
  'nav.settings': 'Cài đặt',

  'toolbar.search': 'Tìm hồ sơ…',
  'toolbar.allGroups': 'Tất cả nhóm',
  'toolbar.import': 'Nhập',
  'toolbar.export': 'Xuất',
  'toolbar.bulkCreate': 'Tạo hàng loạt',
  'toolbar.create': 'Tạo hồ sơ',

  'profiles.empty.title': 'Chưa có hồ sơ nào.',
  'profiles.loading': 'Đang tải hồ sơ…',
  'profiles.errorPrefix': 'Không tải được danh sách hồ sơ:',
  'profiles.retry': 'Thử lại',
  'profiles.prev': '‹ Trước',
  'profiles.next': 'Sau ›',
  'profiles.pagination': 'Trang {page} / {last} · {total} hồ sơ',
  'profiles.deleteConfirm': 'Xóa hồ sơ "{name}"? Hành động này không thể hoàn tác.',
  'profiles.imported': 'Đã nhập {count} hồ sơ',
  'profiles.skipped': ', bỏ qua {count}',

  'table.status': 'Trạng thái',
  'table.name': 'Tên',
  'table.group': 'Nhóm',
  'table.tags': 'Thẻ',
  'table.os': 'HĐH',
  'table.proxy': 'Proxy',
  'table.created': 'Ngày tạo',
  'table.actions': 'Thao tác',
  'table.running': 'Đang chạy',
  'table.stopped': 'Đã dừng',
  'table.launch': 'Mở trình duyệt',
  'table.starting': 'Đang mở…',
  'table.stop': 'Dừng',
  'table.edit': 'Sửa',
  'table.duplicate': 'Nhân bản',
  'table.delete': 'Xóa',
  'table.direct': 'trực tiếp',

  'wizard.title.create': 'Tạo hồ sơ',
  'wizard.title.edit': 'Sửa "{name}"',
  'wizard.step.basics': 'Cơ bản',
  'wizard.step.fingerprint': 'Dấu vân tay',
  'wizard.step.proxy': 'Proxy',
  'wizard.step.review': 'Xem lại',
  'wizard.name': 'Tên *',
  'wizard.namePlaceholder': 'vd. Shop Alpha',
  'wizard.group': 'Nhóm',
  'wizard.tags': 'Thẻ (phân cách bằng dấu phẩy)',
  'wizard.tagsPlaceholder': 'shop, vip',
  'wizard.note': 'Ghi chú',
  'wizard.startupUrls': 'URL mở khi khởi động (mỗi dòng một URL)',
  'wizard.os': 'Hệ điều hành',
  'wizard.regenerate': '↻ Tạo lại',
  'wizard.previewWaiting': 'Đang tạo bản xem trước…',
  'wizard.ua': 'User-Agent',
  'wizard.screen': 'Màn hình',
  'wizard.gpu': 'GPU',
  'wizard.timezone': 'Múi giờ',
  'wizard.cores': 'CPU / RAM',
  'wizard.reviewFingerprint': 'Dấu vân tay',
  'wizard.reviewProxy': 'Proxy',
  'wizard.cancel': 'Hủy',
  'wizard.back': '‹ Quay lại',
  'wizard.next': 'Tiếp ›',
  'wizard.save': 'Lưu thay đổi',
  'wizard.create': 'Tạo hồ sơ',
  'wizard.saving': 'Đang lưu…',
  'wizard.notFound': 'không tìm thấy hồ sơ',

  'proxy.placeholder': 'socks5://user:pass@host:port — bỏ trống nếu không dùng',
  'proxy.test': 'Kiểm tra',
  'proxy.testing': 'Đang kiểm tra…',

  'bulk.title': 'Tạo hàng loạt hồ sơ',
  'bulk.prefix': 'Tiền tố tên',
  'bulk.count': 'Số lượng (1–100)',
  'bulk.group': 'Nhóm',
  'bulk.os': 'HĐH',
  'bulk.sharedProxy': 'Proxy dùng chung (tùy chọn)',
  'bulk.creating': 'Đang tạo… {done}/{count}',
  'bulk.create': 'Tạo {count} hồ sơ',

  'settings.title': 'Cài đặt',
  'settings.loading': 'Đang tải cài đặt…',
  'settings.apiPort': 'Cổng API',
  'settings.apiPortEffective': 'áp dụng sau khi khởi động lại; hiện tại: {port}',
  'settings.dataDir': 'Thư mục dữ liệu (trống = mặc định)',
  'settings.chromium': 'File Chromium (trống = tự tải)',
  'settings.launchAtLogin': 'Khởi động Foxmask cùng máy',
  'settings.save': 'Lưu cài đặt',
  'settings.saving': 'Đang lưu…',
  'settings.saved': 'Đã lưu ✓',

  'tips.hide': 'Ẩn gợi ý',
  'tips.show': 'Hiện gợi ý',

  'tip.profiles': 'Mỗi hồ sơ là một trình duyệt riêng với dấu vân tay, cookie và proxy độc lập — các trang web không thể liên kết chúng với nhau. Tạo một hồ sơ rồi nhấn Mở trình duyệt để dùng.',
  'tip.search': 'Tìm theo tên; danh sách tự cập nhật khi bạn gõ. Bộ lọc nhóm giúp thu hẹp thêm.',
  'tip.launch': 'Chấm xanh = trình duyệt đang chạy. Nút Mở trình duyệt sẽ mở cửa sổ Chromium mang dấu vân tay và proxy của hồ sơ này.',
  'tip.wizard.basics': 'Đặt tên mà sau này bạn còn nhận ra. Nhóm và thẻ chỉ là nhãn để lọc danh sách.',
  'tip.wizard.fingerprint': 'Dấu vân tay khiến mỗi hồ sơ trông như một thiết bị vật lý khác nhau. Không ưng? Nhấn Tạo lại.',
  'tip.wizard.proxy': 'Tùy chọn: dán proxy để hồ sơ này duyệt web từ IP khác. Nhấn Kiểm tra để chắc chắn proxy hoạt động trước khi lưu.',
  'tip.bulk': 'Cần nhiều hồ sơ cùng lúc? Tạo hàng loạt sẽ tạo N hồ sơ có dấu vân tay riêng biệt, dùng chung một nhóm và proxy.',
  'tip.importExport': 'Xuất lưu toàn bộ hồ sơ ra file JSON (sao lưu / chuyển máy). Nhập sẽ khôi phục chúng.',
  'tip.settings': 'Các tùy chọn này dành cho người dùng nâng cao — để mặc định là ổn với đa số mọi người. Cổng API là nơi các công cụ tự động kết nối vào.'
}

const DICTS: Record<Lang, typeof en> = { en, vi }

export type TKey = keyof typeof en

interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  /** True when beginner tips (💡 boxes) are shown. */
  tips: boolean
  setTips: (visible: boolean) => void
  t: (key: TKey, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

const LANG_KEY = 'foxmask.lang'
const TIPS_KEY = 'foxmask.tips'

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'vi' || saved === 'en') return saved
  } catch {
    /* localStorage may be unavailable */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return nav?.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

function detectTips(): boolean {
  try {
    return localStorage.getItem(TIPS_KEY) !== '0'
  } catch {
    return true
  }
}

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [lang, setLangState] = useState<Lang>(detectLang)
  const [tips, setTipsState] = useState<boolean>(detectTips)

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [lang])

  useEffect(() => {
    try {
      localStorage.setItem(TIPS_KEY, tips ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [tips])

  const t = (key: TKey, params?: Record<string, string | number>): string => {
    let text: string = DICTS[lang][key] ?? DICTS.en[key] ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }

  return (
    <I18nContext.Provider
      value={{ lang, setLang: setLangState, tips, setTips: setTipsState, t }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}
