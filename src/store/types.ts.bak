export type BlockType =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulleted'
  | 'numbered'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'page'
  | 'database'
  | 'table'
  | 'bookmark'
  | 'columns'
  | 'column';

/** Notion color names. Text colors are the plain name, backgrounds end in `_background`. */
export type ColorName =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';
export type BlockColor = ColorName | `${ColorName}_background`;

export interface Block {
  id: string;
  type: BlockType;
  /** Sanitized inline HTML (b, i, u, s, code, a, span.c-*, br). */
  html: string;
  children: string[];
  /** Parent block id, or page id for top-level blocks. */
  parent: string;
  checked?: boolean;
  open?: boolean;
  color?: BlockColor;
  icon?: string;
  language?: string;
  url?: string;
  caption?: string;
  width?: number;
  /** For `page` and `database` blocks: the referenced page id. */
  pageId?: string;
  /** A "link to page" block: references a page without owning it. */
  isLink?: boolean;
  /** For `table` blocks: rows of cell html. */
  rows?: string[][];
  headerRow?: boolean;
  createdAt: number;
}

export type PropType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'person'
  | 'created_time'
  | 'last_edited_time';

export interface SelectOption {
  id: string;
  name: string;
  color: ColorName;
  /** Only for `status`: which group the option belongs to. */
  group?: 'todo' | 'in_progress' | 'complete';
}

export interface Property {
  id: string;
  name: string;
  type: PropType;
  options?: SelectOption[];
  numberFormat?: 'number' | 'percent' | 'dollar' | 'euro';
  width?: number;
}

export type ViewType = 'table' | 'board' | 'list' | 'gallery' | 'calendar' | 'timeline';

export interface Filter {
  id: string;
  propId: string;
  op: string;
  value?: any;
}

export interface Sort {
  id: string;
  propId: string;
  dir: 'asc' | 'desc';
}

export interface DbView {
  id: string;
  name: string;
  type: ViewType;
  /** Property ids hidden in this view. */
  hidden: string[];
  /** Property display order for this view. */
  order?: string[];
  filters: Filter[];
  sorts: Sort[];
  groupBy?: string;
  dateProp?: string;
  cardPreview?: 'none' | 'cover' | 'content';
  cardSize?: 'small' | 'medium' | 'large';
  wrapCells?: boolean;
  /** Calculation per property id (e.g. 'count'). */
  calcs?: Record<string, string>;
}

export interface Page {
  id: string;
  title: string;
  icon?: string;
  cover?: string;
  coverPos?: number;
  /** Parent page id; null for workspace-level pages. */
  parentId: string | null;
  /** Top-level block ids of the page content. */
  content: string[];
  createdAt: number;
  updatedAt: number;
  trashed?: boolean;
  trashedAt?: number;
  font?: 'default' | 'serif' | 'mono';
  smallText?: boolean;
  fullWidth?: boolean;
  locked?: boolean;
  /** Database pages. */
  isDatabase?: boolean;
  inline?: boolean;
  schema?: Property[];
  views?: DbView[];
  rows?: string[];
  /** Database row pages: parent database id and property values. */
  dbId?: string;
  props?: Record<string, any>;
  comments?: Comment[];
}

export interface Comment {
  id: string;
  html: string;
  createdAt: number;
  author: string;
}

export interface Teamspace {
  id: string;
  name: string;
  icon: string;
  pages: string[];
}

export interface Workspace {
  name: string;
  icon: string;
  userName: string;
  userEmail: string;
  privatePages: string[];
  favorites: string[];
  teamspaces: Teamspace[];
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeSetting;
  sidebarWidth: number;
  sidebarOpen: boolean;
  startPage: 'home' | 'last';
}

export interface Doc {
  version: number;
  pages: Record<string, Page>;
  blocks: Record<string, Block>;
  workspace: Workspace;
  recent: { id: string; at: number }[];
}
