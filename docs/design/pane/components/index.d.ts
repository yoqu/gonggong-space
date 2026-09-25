import type * as React from 'react';
type Icon = string | React.ReactNode;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default' | 'primary' | 'destructive' | 'glass' | 'plain'; size?: 'small' | 'regular' | 'large' | 'xlarge'; icon?: Icon }
export declare function Button(p: ButtonProps): React.ReactElement;
export interface SwitchProps { checked?: boolean; defaultChecked?: boolean; onChange?(checked: boolean): void; size?: 'small' | 'regular'; disabled?: boolean; label?: React.ReactNode; labelPosition?: 'before' | 'after'; 'aria-label'?: string }
export declare function Switch(p: SwitchProps): React.ReactElement;
export interface CheckboxProps { checked?: boolean; defaultChecked?: boolean; indeterminate?: boolean; onChange?(checked: boolean): void; label?: React.ReactNode; disabled?: boolean }
export declare function Checkbox(p: CheckboxProps): React.ReactElement;
export interface RadioGroupProps { options: { value: string; label: React.ReactNode; disabled?: boolean }[]; value?: string; defaultValue?: string; onChange?(value: string): void; direction?: 'column' | 'row'; name?: string; disabled?: boolean; 'aria-label'?: string }
export declare function RadioGroup(p: RadioGroupProps): React.ReactElement;
export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; size?: 'regular' | 'large' }
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
export type MenuItem = { label: React.ReactNode; value?: string; shortcut?: string; icon?: Icon; checked?: boolean; disabled?: boolean; destructive?: boolean } | { separator: true } | { header: React.ReactNode };
export interface MenuProps { items: MenuItem[]; onSelect?(value: string): void; activeValue?: string; style?: React.CSSProperties }
export declare function Menu(p: MenuProps): React.ReactElement;
export interface SidebarProps { sections: { title?: React.ReactNode; items: { id: string; label: React.ReactNode; icon?: Icon; color?: string; badge?: React.ReactNode }[] }[]; selected?: string; defaultSelected?: string; onSelect?(id: string): void; style?: React.CSSProperties }
export declare function Sidebar(p: SidebarProps): React.ReactElement;
export interface ToolbarProps { title?: React.ReactNode; subtitle?: React.ReactNode; leading?: React.ReactNode; children?: React.ReactNode }
export declare function Toolbar(p: ToolbarProps): React.ReactElement;
export declare function ToolbarGroup(p: { children?: React.ReactNode }): React.ReactElement;
export declare function ToolbarButton(p: { icon?: Icon; label: string; text?: React.ReactNode; active?: boolean; onClick?(): void }): React.ReactElement;
export interface WindowProps { title?: string; sidebar?: React.ReactNode; toolbar?: React.ReactNode; children?: React.ReactNode; inactive?: boolean; width?: number | string; height?: number | string; contentStyle?: React.CSSProperties; style?: React.CSSProperties }
export declare function Window(p: WindowProps): React.ReactElement;
export declare function TrafficLights(p: { inactive?: boolean }): React.ReactElement;
export interface AlertProps { title: React.ReactNode; message?: React.ReactNode; icon?: React.ReactNode; suppression?: React.ReactNode; actions?: { label: React.ReactNode; variant?: ButtonProps['variant']; onClick?(): void }[] }
export declare function Alert(p: AlertProps): React.ReactElement;
export interface TabViewProps { tabs: { value: string; label: React.ReactNode; content: React.ReactNode }[]; value?: string; defaultValue?: string; onChange?(v: string): void }
export declare function TabView(p: TabViewProps): React.ReactElement;
export declare function GroupBox(p: { children?: React.ReactNode; style?: React.CSSProperties }): React.ReactElement;
export declare function GroupRow(p: { label: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }): React.ReactElement;
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
export declare function Reactions(p: { items: Reaction[]; onToggle?(emoji: string): void; onAdd?(): void; compact?: boolean }): React.ReactElement;
export declare function ReadReceipt(p: { read: number; total?: number }): React.ReactElement;
export interface ThreadSummaryProps { count: number; people?: AvatarProps[]; lastTime?: string; onClick?(): void }
export declare function ThreadSummary(p: ThreadSummaryProps): React.ReactElement;
export interface MessageAction { icon: Icon; label: string; onClick?(): void }
export declare function MessageActions(p: { items?: MessageAction[]; onAction?(label: string): void }): React.ReactElement;
export interface MessageProps { author: { name: string; avatar?: string; status?: AvatarProps['status']; tags?: { label: string; tone: TagTone }[] }; time?: string; self?: boolean; continued?: boolean; bare?: boolean; children?: React.ReactNode; reply?: { author: string; text: React.ReactNode }; reactions?: Reaction[]; onReact?(emoji: string): void; thread?: ThreadSummaryProps; receipt?: { read: number; total?: number }; status?: 'sending' | 'sent' | 'failed'; onRetry?(): void; urgent?: boolean; edited?: boolean; actions?: MessageAction[] | false; onAction?(label: string): void; showActions?: boolean; showAvatar?: boolean }
export declare function Message(p: MessageProps): React.ReactElement;
export declare function MessageList(p: { children?: React.ReactNode; style?: React.CSSProperties }): React.ReactElement;
export declare function FileAttachment(p: { name: string; size?: string; meta?: string; ext?: string; progress?: number; onDownload?: (() => void) | false }): React.ReactElement;
export declare function ImageAttachment(p: { src: string; alt?: string; width?: number; height?: number }): React.ReactElement;
export declare function DocLink(p: { title: React.ReactNode; kind?: 'doc' | 'sheet' | 'base' | 'slides' | 'wiki' | 'mindnote'; owner?: string; updated?: string; permission?: React.ReactNode; action?: React.ReactNode }): React.ReactElement;
export interface MessageCardProps { title: React.ReactNode; template?: 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'gray'; icon?: Icon; status?: { label: string; tone: TagTone }; fields?: { label: React.ReactNode; value: React.ReactNode; short?: boolean }[]; children?: React.ReactNode; actions?: { label: React.ReactNode; variant?: ButtonProps['variant']; onClick?(): void; disabled?: boolean }[]; note?: React.ReactNode }
export declare function MessageCard(p: MessageCardProps): React.ReactElement;
export declare function ChatNotice(p: { kind?: 'date' | 'system' | 'unread' | 'urgent'; day?: string; children?: React.ReactNode }): React.ReactElement;
export declare function PinnedBanner(p: { text: React.ReactNode; title?: React.ReactNode; icon?: Icon; color?: string; action?: React.ReactNode; onClose?(): void; style?: React.CSSProperties }): React.ReactElement;
export interface ComposerProps { value?: string; defaultValue?: string; onChange?(v: string): void; onSend?(text: string): void; placeholder?: string; recipient?: string; replyTo?: { author: string; text: React.ReactNode }; onCancelReply?(): void; tools?: { icon: Icon; label: string; onClick?(): void }[]; hint?: React.ReactNode | false; disabled?: boolean }
export declare function Composer(p: ComposerProps): React.ReactElement;
declare global { interface Window { Pane: { Button: typeof Button; Switch: typeof Switch; Checkbox: typeof Checkbox; RadioGroup: typeof RadioGroup; TextField: typeof TextField; SearchField: typeof SearchField; SegmentedControl: typeof SegmentedControl; Slider: typeof Slider; ProgressIndicator: typeof ProgressIndicator; PopUpButton: typeof PopUpButton; Menu: typeof Menu; Sidebar: typeof Sidebar; Toolbar: typeof Toolbar; ToolbarGroup: typeof ToolbarGroup; ToolbarButton: typeof ToolbarButton; Window: typeof Window; TrafficLights: typeof TrafficLights; Alert: typeof Alert; TabView: typeof TabView; GroupBox: typeof GroupBox; GroupRow: typeof GroupRow; Icon: typeof Icon; Avatar: typeof Avatar; AvatarGroup: typeof AvatarGroup; Tag: typeof Tag; Badge: typeof Badge; ConversationList: typeof ConversationList; ConversationItem: typeof ConversationItem; ChatHeader: typeof ChatHeader; Mention: typeof Mention; Reactions: typeof Reactions; ReadReceipt: typeof ReadReceipt; ThreadSummary: typeof ThreadSummary; MessageActions: typeof MessageActions; Message: typeof Message; MessageList: typeof MessageList; FileAttachment: typeof FileAttachment; ImageAttachment: typeof ImageAttachment; DocLink: typeof DocLink; MessageCard: typeof MessageCard; ChatNotice: typeof ChatNotice; PinnedBanner: typeof PinnedBanner; Composer: typeof Composer } } }
