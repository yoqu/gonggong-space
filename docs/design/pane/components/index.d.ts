import type * as React from 'react';
type Icon = string | React.ReactNode;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default' | 'primary' | 'destructive' | 'glass' | 'plain'; size?: 'small' | 'regular' | 'large' | 'xlarge'; icon?: Icon; loading?: boolean }
export declare function Button(p: ButtonProps): React.ReactElement;
export interface SwitchProps { checked?: boolean; defaultChecked?: boolean; onChange?(checked: boolean): void; size?: 'small' | 'regular'; disabled?: boolean; label?: React.ReactNode; labelPosition?: 'before' | 'after'; 'aria-label'?: string }
export declare function Switch(p: SwitchProps): React.ReactElement;
export interface CheckboxProps { checked?: boolean; defaultChecked?: boolean; indeterminate?: boolean; onChange?(checked: boolean): void; label?: React.ReactNode; disabled?: boolean }
export declare function Checkbox(p: CheckboxProps): React.ReactElement;
export interface RadioGroupProps { options: { value: string; label: React.ReactNode; disabled?: boolean }[]; value?: string; defaultValue?: string; onChange?(value: string): void; direction?: 'column' | 'row'; name?: string; disabled?: boolean; 'aria-label'?: string }
export declare function RadioGroup(p: RadioGroupProps): React.ReactElement;
export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; size?: 'regular' | 'large'; prefix?: Icon; suffix?: Icon; clearable?: boolean; onClear?(): void; trailing?: React.ReactNode; inputRef?: React.MutableRefObject<HTMLInputElement | null> }
export declare function TextField(p: TextFieldProps): React.ReactElement;
export interface SearchFieldProps { placeholder?: string; value?: string; defaultValue?: string; onChange?(text: string): void; onSubmit?(text: string): void; style?: React.CSSProperties; 'aria-label'?: string }
export declare function SearchField(p: SearchFieldProps): React.ReactElement;
export interface SegmentedControlProps { items: { value: string; label?: React.ReactNode; icon?: Icon; 'aria-label'?: string }[]; value?: string; defaultValue?: string; onChange?(value: string): void; size?: 'small' | 'regular' | 'large'; 'aria-label'?: string }
export declare function SegmentedControl(p: SegmentedControlProps): React.ReactElement;
export interface SliderProps { min?: number; max?: number; step?: number; value?: number; defaultValue?: number; onChange?(v: number): void; ticks?: number; minLabel?: React.ReactNode; maxLabel?: React.ReactNode; disabled?: boolean; style?: React.CSSProperties; 'aria-label'?: string }
export declare function Slider(p: SliderProps): React.ReactElement;
export interface ProgressIndicatorProps { value?: number; variant?: 'bar' | 'spinner'; style?: React.CSSProperties; 'aria-label'?: string }
export declare function ProgressIndicator(p: ProgressIndicatorProps): React.ReactElement;
export interface PopUpButtonProps { options: { value: string; label: React.ReactNode }[]; value?: string; defaultValue?: string; onChange?(value: string): void; size?: ButtonProps['size']; placeholder?: string; defaultOpen?: boolean; disabled?: boolean }
export declare function PopUpButton(p: PopUpButtonProps): React.ReactElement;
export type MenuItem = { label: React.ReactNode; value?: string; shortcut?: string; icon?: Icon; checked?: boolean; disabled?: boolean; destructive?: boolean; submenu?: MenuItem[] } | { separator: true } | { header: React.ReactNode };
export interface MenuProps { items: MenuItem[]; onSelect?(value: string): void; onClose?(): void; activeValue?: string; autoFocus?: boolean; defaultOpenSubmenu?: number; isSubmenu?: boolean; style?: React.CSSProperties }
export declare function Menu(p: MenuProps): React.ReactElement;
export interface SidebarItem { id: string; label: React.ReactNode; icon?: Icon; color?: string; badge?: React.ReactNode; children?: SidebarItem[] }
export interface SidebarProps { sections: { id?: string; title?: React.ReactNode; collapsible?: boolean; items: SidebarItem[] }[]; selected?: string; defaultSelected?: string; onSelect?(id: string): void; defaultCollapsed?: string[]; defaultExpanded?: string[]; iconStyle?: 'glyph' | 'tile'; style?: React.CSSProperties; 'aria-label'?: string }
export declare function Sidebar(p: SidebarProps): React.ReactElement;
export interface ToolbarProps { title?: React.ReactNode; subtitle?: React.ReactNode; leading?: React.ReactNode; children?: React.ReactNode }
export declare function Toolbar(p: ToolbarProps): React.ReactElement;
export declare function ToolbarGroup(p: { children?: React.ReactNode }): React.ReactElement;
export declare function ToolbarButton(p: { icon?: Icon; label: string; text?: React.ReactNode; active?: boolean; onClick?(): void }): React.ReactElement;
export interface WindowProps { title?: string; rail?: React.ReactNode; inspector?: React.ReactNode; sidebar?: React.ReactNode; toolbar?: React.ReactNode; children?: React.ReactNode; inactive?: boolean; width?: number | string; height?: number | string; contentStyle?: React.CSSProperties; style?: React.CSSProperties }
export declare function Window(p: WindowProps): React.ReactElement;
export declare function TrafficLights(p: { inactive?: boolean }): React.ReactElement;
export interface AlertProps { title: React.ReactNode; message?: React.ReactNode; icon?: React.ReactNode; suppression?: React.ReactNode; actions?: { label: React.ReactNode; variant?: ButtonProps['variant']; onClick?(): void }[] }
export declare function Alert(p: AlertProps): React.ReactElement;
export interface TabViewProps { tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]; value?: string; defaultValue?: string; onChange?(v: string): void }
export declare function TabView(p: TabViewProps): React.ReactElement;
export declare function GroupBox(p: { children?: React.ReactNode; style?: React.CSSProperties }): React.ReactElement;
export interface GroupRowProps { label: React.ReactNode; description?: React.ReactNode; value?: React.ReactNode; chevron?: boolean; onClick?(): void; destructive?: boolean; children?: React.ReactNode }
export declare function GroupRow(p: GroupRowProps): React.ReactElement;
export declare function Icon(p: { name: string; size?: number; color?: string; weight?: number; label?: string }): React.ReactElement;

/* ---------- IM ---------- */
export interface AvatarProps { name: string; src?: string; size?: number; status?: 'online' | 'busy' | 'away'; shape?: 'circle' | 'square'; color?: string; style?: React.CSSProperties }
export declare function Avatar(p: AvatarProps): React.ReactElement;
export declare function AvatarGroup(p: { people: AvatarProps[]; size?: number; max?: number }): React.ReactElement;
export type TagTone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray' | 'solid-red';
export declare function Tag(p: { tone?: TagTone; icon?: Icon; children?: React.ReactNode }): React.ReactElement;
export declare function Badge(p: { count: number; muted?: boolean }): React.ReactElement | null;
export interface Conversation { id: string; name: string; avatar?: string; avatarNode?: React.ReactNode; group?: boolean; status?: AvatarProps['status']; tags?: { label: string; tone: TagTone }[]; time?: string; preview?: React.ReactNode; unread?: number; unreadDot?: boolean; muted?: boolean; pinned?: boolean; mention?: boolean; urgent?: boolean; draft?: string }
export interface ConversationListProps { items: Conversation[]; selected?: string; defaultSelected?: string; onSelect?(id: string): void; header?: React.ReactNode; style?: React.CSSProperties; 'aria-label'?: string }
export declare function ConversationList(p: ConversationListProps): React.ReactElement;
export declare function ConversationItem(p: { item: Conversation; selected?: boolean; onClick?(): void }): React.ReactElement;
export interface ChatHeaderProps { title: React.ReactNode; subtitle?: React.ReactNode; group?: boolean; avatar?: React.ReactNode; tags?: { label: string; tone: TagTone }[]; actions?: { icon: Icon; label: string; onClick?(): void; active?: boolean }[]; tabs?: { value: string; label: React.ReactNode }[]; tab?: string; defaultTab?: string; onTabChange?(v: string): void; trailing?: React.ReactNode }
export declare function ChatHeader(p: ChatHeaderProps): React.ReactElement;
export declare function Mention(p: { name: string; me?: boolean }): React.ReactElement;
export interface Reaction { emoji: string; users: string[]; mine?: boolean; label?: string }
export declare function Reactions(p: { items: Reaction[]; onToggle?(emoji: string): void; onAdd?(): void; addable?: boolean; defaultPickerOpen?: boolean; compact?: boolean }): React.ReactElement;
export declare function ReadReceipt(p: { read: number; total?: number }): React.ReactElement;
export interface ThreadSummaryProps { count: number; people?: AvatarProps[]; lastTime?: string; onClick?(): void }
export declare function ThreadSummary(p: ThreadSummaryProps): React.ReactElement;
export interface MessageAction { icon: Icon; label: string; onClick?(): void }
export declare function MessageActions(p: { items?: MessageAction[]; onAction?(label: string): void }): React.ReactElement;
export interface MessageProps { author: { name: string; avatar?: string; status?: AvatarProps['status']; tags?: { label: string; tone: TagTone }[] }; time?: string; self?: boolean; continued?: boolean; bare?: boolean; children?: React.ReactNode; reply?: { author: string; text: React.ReactNode }; reactions?: Reaction[]; onReact?(emoji: string): void; thread?: ThreadSummaryProps; receipt?: { read: number; total?: number }; status?: 'sending' | 'sent' | 'failed'; onRetry?(): void; urgent?: boolean; edited?: boolean; actions?: MessageAction[] | false; onAction?(label: string): void; showActions?: boolean; showAvatar?: boolean }
export declare function Message(p: MessageProps): React.ReactElement;
export declare function MessageList(p: { children?: React.ReactNode; stickToBottom?: boolean; style?: React.CSSProperties }): React.ReactElement;
export declare function FileAttachment(p: { name: string; size?: string; meta?: string; ext?: string; progress?: number; onDownload?: (() => void) | false }): React.ReactElement;
export declare function ImageAttachment(p: { src: string; alt?: string; width?: number; height?: number }): React.ReactElement;
export declare function DocLink(p: { title: React.ReactNode; kind?: 'doc' | 'sheet' | 'base' | 'slides' | 'wiki' | 'mindnote'; owner?: string; updated?: string; permission?: React.ReactNode; action?: React.ReactNode }): React.ReactElement;
export interface MessageCardProps { title: React.ReactNode; template?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray'; icon?: Icon; status?: { label: string; tone: TagTone }; fields?: { label: React.ReactNode; value: React.ReactNode; short?: boolean }[]; children?: React.ReactNode; actions?: { label: React.ReactNode; variant?: ButtonProps['variant']; onClick?(): void; disabled?: boolean }[]; note?: React.ReactNode }
export declare function MessageCard(p: MessageCardProps): React.ReactElement;
export declare function ChatNotice(p: { kind?: 'date' | 'system' | 'unread' | 'urgent' | 'recalled'; day?: string; action?: { label: string; onClick?(): void }; children?: React.ReactNode }): React.ReactElement;
export declare function PinnedBanner(p: { text: React.ReactNode; title?: React.ReactNode; icon?: Icon; color?: string; action?: React.ReactNode; onClose?(): void; style?: React.CSSProperties }): React.ReactElement;
export interface ComposerProps { value?: string; defaultValue?: string; onChange?(v: string): void; onSend?(text: string): void; placeholder?: string; recipient?: string; replyTo?: { author: string; text: React.ReactNode }; onCancelReply?(): void; tools?: { icon: Icon; label: string; onClick?(): void }[]; hint?: React.ReactNode | false; accessory?: React.ReactNode; disabled?: boolean; mentions?: MentionMember[]; mentionAll?: boolean; onMention?(m: MentionMember): void; defaultMentionOpen?: boolean; recentEmoji?: string[]; defaultEmojiOpen?: boolean }
export declare function Composer(p: ComposerProps): React.ReactElement;
export interface NavRailItem { id: string; label: string; icon: Icon; badge?: number; muted?: boolean; dot?: boolean }
export interface NavRailProps { items: NavRailItem[]; footer?: NavRailItem[]; avatar?: AvatarProps; selected?: string; defaultSelected?: string; onSelect?(id: string): void; style?: React.CSSProperties }
export declare function NavRail(p: NavRailProps): React.ReactElement;
export interface ChatInfoPanelProps { title?: string; onClose?(): void; name: React.ReactNode; group?: boolean; avatar?: React.ReactNode; description?: React.ReactNode; tags?: { label: string; tone: TagTone }[]; shortcuts?: { icon: Icon; label: string; onClick?(): void }[]; members?: AvatarProps[]; memberCount?: number; maxMembers?: number; onAddMember?(): void; onShowAllMembers?(): void; settings?: (GroupRowProps & { control?: React.ReactNode })[]; danger?: { label: string; onClick?(): void }; children?: React.ReactNode; style?: React.CSSProperties }
export declare function ChatInfoPanel(p: ChatInfoPanelProps): React.ReactElement;
export interface ThreadPanelProps { title?: string; subtitle?: React.ReactNode; onClose?(): void; root: React.ReactNode; replyCount?: number; children?: React.ReactNode; composer?: false; composerProps?: ComposerProps; alsoSend?: boolean; alsoSendDefault?: boolean; style?: React.CSSProperties }
export declare function ThreadPanel(p: ThreadPanelProps): React.ReactElement;
export interface PopoverProps { trigger: React.ReactNode; children?: React.ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?(open: boolean): void; placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start'; width?: number | string; 'aria-label'?: string }
export declare function Popover(p: PopoverProps): React.ReactElement;
export interface MentionMember { id?: string; name: string; subtitle?: string; pinyin?: string; avatar?: string; status?: AvatarProps['status']; all?: boolean }
export interface MentionPickerProps { members?: MentionMember[]; items?: MentionMember[]; query?: string; includeAll?: boolean; activeIndex?: number; onActiveChange?(i: number): void; onSelect?(m: MentionMember): void; style?: React.CSSProperties }
export declare function MentionPicker(p: MentionPickerProps): React.ReactElement;
export interface ProfileCardProps { name: string; avatar?: string; status?: AvatarProps['status']; statusText?: React.ReactNode; title?: React.ReactNode; tags?: { label: string; tone: TagTone }[]; fields?: { label: React.ReactNode; value: React.ReactNode }[]; actions?: { label: string; icon?: Icon; variant?: ButtonProps['variant']; text?: false; onClick?(): void }[]; style?: React.CSSProperties }
export declare function ProfileCard(p: ProfileCardProps): React.ReactElement;
export interface EmojiPickerProps { onSelect?(emoji: string): void; recent?: string[]; defaultCategory?: 'recent' | 'smile' | 'hand' | 'symbol'; style?: React.CSSProperties }
export declare function EmojiPicker(p: EmojiPickerProps): React.ReactElement;
export declare function VoiceMessage(p: { duration: number; played?: boolean; playing?: boolean; progress?: number; transcript?: React.ReactNode; seed?: string; onPlay?(playing: boolean): void }): React.ReactElement;
export declare function LinkPreview(p: { url: string; title: React.ReactNode; site?: string; description?: React.ReactNode; image?: string; style?: React.CSSProperties }): React.ReactElement;
export declare function CodeBlock(p: { code: string; language?: string; filename?: string; style?: React.CSSProperties }): React.ReactElement;
export interface MeetingCardProps { title: React.ReactNode; time?: React.ReactNode; status?: 'scheduled' | 'live' | 'ended'; startsIn?: string; meetingId?: string; host?: string; duration?: string; participants?: AvatarProps[]; joined?: number; onJoin?(): void; onReplay?(): void; style?: React.CSSProperties }
export declare function MeetingCard(p: MeetingCardProps): React.ReactElement;
export interface EventCardProps { title: React.ReactNode; month: string; day: number | string; weekday?: string; time: React.ReactNode; location?: React.ReactNode; organizer?: string; attendees?: number; rsvp?: 'accepted' | 'tentative' | 'declined' | null | false; defaultRsvp?: 'accepted' | 'tentative' | 'declined'; onRsvp?(v: string): void; style?: React.CSSProperties }
export declare function EventCard(p: EventCardProps): React.ReactElement;
export declare function EmptyState(p: { title: React.ReactNode; description?: React.ReactNode; icon?: Icon | false; action?: React.ReactNode; compact?: boolean; style?: React.CSSProperties }): React.ReactElement;
export declare function Skeleton(p: { variant?: 'text' | 'conversation' | 'message' | 'block'; count?: number; width?: number | string; height?: number | string; label?: string; style?: React.CSSProperties }): React.ReactElement;
export declare function TypingIndicator(p: { name?: string | string[]; bubble?: boolean }): React.ReactElement;
export interface NotificationBannerProps { title: React.ReactNode; body: React.ReactNode; subtitle?: React.ReactNode; time?: string; app?: { name: string; icon?: React.ReactNode }; avatar?: AvatarProps; actions?: { label: string; onClick?(): void }[]; stacked?: number; onClose?(): void; style?: React.CSSProperties }
export declare function NotificationBanner(p: NotificationBannerProps): React.ReactElement;
export interface ContextMenuProps { items: MenuItem[]; onSelect?(value: string): void; children?: React.ReactNode; defaultPosition?: { x: number; y: number }; activeValue?: string; onOpen?(): void; style?: React.CSSProperties }
export declare function ContextMenu(p: ContextMenuProps): React.ReactElement;
export declare function messageMenuItems(opts?: { self?: boolean }): MenuItem[];
export interface TableColumn<R = any> { key: string; title: React.ReactNode; width?: number | string; align?: 'left' | 'right' | 'center'; sortable?: boolean; sortValue?(row: R): string | number; render?(row: R): React.ReactNode; secondary?: boolean; mono?: boolean }
export interface TableRow { id: string | number; children?: TableRow[]; [key: string]: any }
export interface TableProps<R extends TableRow = TableRow> { columns: TableColumn<R>[]; rows: R[]; selection?: (string | number)[]; defaultSelection?: (string | number)[]; onSelectionChange?(ids: (string | number)[]): void; multiple?: boolean; sort?: { key: string; dir: 'asc' | 'desc' } | null; defaultSort?: { key: string; dir: 'asc' | 'desc' }; onSortChange?(s: { key: string; dir: 'asc' | 'desc' }): void; sortRows?: boolean; defaultExpanded?: (string | number)[]; onOpen?(row: R): void; alternating?: boolean; density?: 'regular' | 'compact'; active?: boolean; emptyText?: React.ReactNode; height?: number | string; maxHeight?: number | string; style?: React.CSSProperties; 'aria-label'?: string }
export declare function Table<R extends TableRow = TableRow>(p: TableProps<R>): React.ReactElement;
export interface ModalAction { label: React.ReactNode; variant?: ButtonProps['variant']; onClick?(): void; disabled?: boolean; autoFocus?: boolean }
export interface SheetProps { open: boolean; onClose?(): void; title?: React.ReactNode; message?: React.ReactNode; children?: React.ReactNode; actions?: ModalAction[]; footer?: React.ReactNode; width?: number | string; closeOnScrim?: boolean; trapFocus?: boolean; 'aria-label'?: string }
export declare function Sheet(p: SheetProps): React.ReactElement | null;
export interface DialogProps extends SheetProps { bare?: boolean; contained?: boolean; role?: 'dialog' | 'alertdialog' }
export declare function Dialog(p: DialogProps): React.ReactElement | null;
export interface SecureFieldProps extends TextFieldProps { revealable?: boolean }
export declare function SecureField(p: SecureFieldProps): React.ReactElement;
export interface TextAreaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'prefix'> { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; autoGrow?: boolean; maxHeight?: number; showCount?: boolean }
export declare function TextArea(p: TextAreaProps): React.ReactElement;
export interface StepperProps { value?: number; defaultValue?: number; onChange?(v: number): void; min?: number; max?: number; step?: number; precision?: number; unit?: React.ReactNode; label?: React.ReactNode; width?: number; disabled?: boolean; 'aria-label'?: string; style?: React.CSSProperties }
export declare function Stepper(p: StepperProps): React.ReactElement;
export interface ComboBoxProps { options: (string | { value: string; label: string; detail?: string })[]; value?: string; defaultValue?: string; onChange?(value: string, option: { value: string; label: string }): void; onInput?(text: string): void; placeholder?: string; label?: React.ReactNode; defaultOpen?: boolean; disabled?: boolean; style?: React.CSSProperties }
export declare function ComboBox(p: ComboBoxProps): React.ReactElement;
export declare function Form(p: { children?: React.ReactNode; labelWidth?: number | string; onSubmit?(e: React.FormEvent): void; style?: React.CSSProperties; 'aria-label'?: string }): React.ReactElement;
export declare function FormRow(p: { label?: string; hint?: React.ReactNode; align?: 'center' | 'top'; colon?: boolean; children?: React.ReactNode }): React.ReactElement;
export declare function FormActions(p: { children?: React.ReactNode }): React.ReactElement;
export declare function CheckboxGroup(p: { options: { value: string; label: React.ReactNode; disabled?: boolean }[]; value?: string[]; defaultValue?: string[]; onChange?(v: string[]): void; direction?: 'column' | 'row'; disabled?: boolean; 'aria-label'?: string }): React.ReactElement;
export declare function Divider(p: { vertical?: boolean; label?: React.ReactNode; style?: React.CSSProperties }): React.ReactElement;
export declare function Link(p: React.AnchorHTMLAttributes<HTMLAnchorElement> & { external?: boolean }): React.ReactElement;
export declare function HelpButton(p: { help?: React.ReactNode; onClick?(): void; placement?: PopoverProps['placement']; defaultOpen?: boolean; 'aria-label'?: string }): React.ReactElement;
export type DateValue = string | Date;
export interface CalendarProps { value?: DateValue | null; defaultValue?: DateValue | null; onChange?(isoDate: string): void; min?: DateValue; max?: DateValue; marks?: DateValue[]; weekStart?: 0 | 1; today?: DateValue; style?: React.CSSProperties; 'aria-label'?: string }
export declare function Calendar(p: CalendarProps): React.ReactElement;
export interface DatePickerProps { value?: DateValue | null; defaultValue?: DateValue | null; onChange?(isoDate: string): void; label?: React.ReactNode; placeholder?: string; min?: DateValue; max?: DateValue; marks?: DateValue[]; showWeekday?: boolean; placement?: PopoverProps['placement']; defaultOpen?: boolean; disabled?: boolean; today?: DateValue; style?: React.CSSProperties }
export declare function DatePicker(p: DatePickerProps): React.ReactElement;
export declare function Disclosure(p: { title: React.ReactNode; summary?: React.ReactNode; open?: boolean; defaultOpen?: boolean; onToggle?(open: boolean): void; variant?: 'plain' | 'group'; children?: React.ReactNode; style?: React.CSSProperties }): React.ReactElement;
export declare function Tooltip(p: { content: React.ReactNode; shortcut?: string; placement?: 'top' | 'bottom'; delay?: number; defaultOpen?: boolean; children: React.ReactElement }): React.ReactElement;
export declare function Kbd(p: { keys?: string[]; children?: React.ReactNode }): React.ReactElement;
export declare function Toast(p: { message: React.ReactNode; icon?: Icon; iconColor?: string; action?: { label: string; onClick?(): void }; open?: boolean; duration?: number; onClose?(): void; style?: React.CSSProperties }): React.ReactElement | null;
export declare function HUD(p: { icon?: Icon; title?: React.ReactNode; level?: number; open?: boolean; style?: React.CSSProperties }): React.ReactElement | null;
export type Token = string | { label: string; tone?: 'blue' | 'gray' | 'orange' | 'green'; detail?: string };
export declare function TokenField(p: { value?: Token[]; defaultValue?: Token[]; onChange?(v: Token[]): void; suggestions?: Token[]; label?: React.ReactNode; placeholder?: string; hint?: React.ReactNode; commitOnBlur?: boolean; style?: React.CSSProperties }): React.ReactElement;
export interface PullDownButtonProps { label?: React.ReactNode; icon?: Icon; items: MenuItem[]; onSelect?(value: string): void; variant?: ButtonProps['variant']; size?: ButtonProps['size']; align?: 'start' | 'end'; defaultOpen?: boolean; disabled?: boolean; 'aria-label'?: string; style?: React.CSSProperties }
export declare function PullDownButton(p: PullDownButtonProps): React.ReactElement;
export interface PathItem { id: string; label: React.ReactNode; icon?: Icon; color?: string }
export declare function PathControl(p: { items: PathItem[]; onSelect?(id: string): void; maxItems?: number; style?: React.CSSProperties; 'aria-label'?: string }): React.ReactElement;
export interface LevelIndicatorProps { kind?: 'capacity' | 'discrete' | 'rating'; value?: number; defaultValue?: number; onChange?(v: number): void; max?: number; warning?: number; critical?: number; segments?: number; parts?: { value: number; color?: string; label?: string }[]; label?: React.ReactNode; editable?: boolean; size?: number; style?: React.CSSProperties; 'aria-label'?: string }
export declare function LevelIndicator(p: LevelIndicatorProps): React.ReactElement;
export declare function ColorWell(p: { value?: string; defaultValue?: string; onChange?(hex: string): void; colors?: string[]; names?: string[]; inline?: boolean; label?: React.ReactNode; defaultOpen?: boolean; style?: React.CSSProperties; 'aria-label'?: string }): React.ReactElement;
export interface DropFile { name: string; size?: string; progress?: number; error?: React.ReactNode }
export interface DropZoneProps { onFiles?(files: File[]): void; accept?: string; multiple?: boolean; title?: React.ReactNode; overTitle?: React.ReactNode; description?: React.ReactNode; buttonLabel?: React.ReactNode; icon?: Icon; files?: DropFile[]; onRemove?(index: number, file: DropFile): void; compact?: boolean; disabled?: boolean; defaultDragging?: boolean; style?: React.CSSProperties; 'aria-label'?: string }
export declare function DropZone(p: DropZoneProps): React.ReactElement;
declare global { interface Window { Pane: { Button: typeof Button; Switch: typeof Switch; Checkbox: typeof Checkbox; RadioGroup: typeof RadioGroup; TextField: typeof TextField; SearchField: typeof SearchField; SegmentedControl: typeof SegmentedControl; Slider: typeof Slider; ProgressIndicator: typeof ProgressIndicator; PopUpButton: typeof PopUpButton; Menu: typeof Menu; Sidebar: typeof Sidebar; Toolbar: typeof Toolbar; ToolbarGroup: typeof ToolbarGroup; ToolbarButton: typeof ToolbarButton; Window: typeof Window; TrafficLights: typeof TrafficLights; Alert: typeof Alert; TabView: typeof TabView; GroupBox: typeof GroupBox; GroupRow: typeof GroupRow; Icon: typeof Icon; Avatar: typeof Avatar; AvatarGroup: typeof AvatarGroup; Tag: typeof Tag; Badge: typeof Badge; ConversationList: typeof ConversationList; ConversationItem: typeof ConversationItem; ChatHeader: typeof ChatHeader; Mention: typeof Mention; Reactions: typeof Reactions; ReadReceipt: typeof ReadReceipt; ThreadSummary: typeof ThreadSummary; MessageActions: typeof MessageActions; Message: typeof Message; MessageList: typeof MessageList; FileAttachment: typeof FileAttachment; ImageAttachment: typeof ImageAttachment; DocLink: typeof DocLink; MessageCard: typeof MessageCard; ChatNotice: typeof ChatNotice; PinnedBanner: typeof PinnedBanner; Composer: typeof Composer; NavRail: typeof NavRail; ChatInfoPanel: typeof ChatInfoPanel; ThreadPanel: typeof ThreadPanel; Popover: typeof Popover; MentionPicker: typeof MentionPicker; ProfileCard: typeof ProfileCard; EmojiPicker: typeof EmojiPicker; VoiceMessage: typeof VoiceMessage; LinkPreview: typeof LinkPreview; CodeBlock: typeof CodeBlock; MeetingCard: typeof MeetingCard; EventCard: typeof EventCard; EmptyState: typeof EmptyState; Skeleton: typeof Skeleton; TypingIndicator: typeof TypingIndicator; NotificationBanner: typeof NotificationBanner; ContextMenu: typeof ContextMenu; messageMenuItems: typeof messageMenuItems; Table: typeof Table; Sheet: typeof Sheet; Dialog: typeof Dialog; SecureField: typeof SecureField; TextArea: typeof TextArea; Stepper: typeof Stepper; ComboBox: typeof ComboBox; Form: typeof Form; FormRow: typeof FormRow; FormActions: typeof FormActions; CheckboxGroup: typeof CheckboxGroup; Divider: typeof Divider; Link: typeof Link; HelpButton: typeof HelpButton; Calendar: typeof Calendar; DatePicker: typeof DatePicker; Disclosure: typeof Disclosure; Tooltip: typeof Tooltip; Kbd: typeof Kbd; Toast: typeof Toast; HUD: typeof HUD; TokenField: typeof TokenField; PullDownButton: typeof PullDownButton; PathControl: typeof PathControl; LevelIndicator: typeof LevelIndicator; ColorWell: typeof ColorWell; DropZone: typeof DropZone } } }
