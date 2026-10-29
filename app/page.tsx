'use client'

import React, { useState, useEffect, useMemo } from 'react';
import {
  ChefHat,
  Receipt,
  Utensils,
  ArrowLeft,
  Plus,
  Minus,
  CheckCircle,
  Clock,
  Play,
  Flame,
  Settings,
  Save,
  History,
} from 'lucide-react';

import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseOptions,
} from 'firebase/app';

import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';

import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  addDoc,
  runTransaction,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';

// ============================================================
// Application types
// ============================================================

type Role =
  | 'cashier'
  | 'cooker'
  | 'server'
  | 'manager'
  | 'history';

type OrderStatus = 'pending' | 'served' | 'cancelled' | string;

interface MenuItemBase {
  id: string;
  name: string;
  price: number;
  color?: string;
  available?: boolean;
}

interface MenuComboItem extends MenuItemBase {
  desc?: string;
  contains?: Record<string, number>;
}

type MenuItem = MenuItemBase | MenuComboItem;
type MenuBase = Record<string, MenuItemBase>;
type MenuCombos = Record<string, MenuComboItem>;

interface MenuDefinition {
  base: MenuBase;
  combos: MenuCombos;
}

interface OrderItemDetails {
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  items: Record<string, number>;
  itemDetails?: Record<string, OrderItemDetails>;
  customerName?: string;
  totalPrice: number;
  status: OrderStatus;
  timestamp: number;
  servedAt?: number;
}

interface InventoryBatch {
  id: string;
  qty: number;
  timestamp: number;
}

interface InventoryEntry {
  batches: InventoryBatch[];
  ready: number;
}

type InventoryState = Record<string, InventoryEntry>;
type QuantityMap = Record<string, number>;
type BooleanMap = Record<string, boolean>;

type RoleSetter = React.Dispatch<
  React.SetStateAction<Role | null>
>;

interface RoleSelectionProps {
  setRole: RoleSetter;
}

interface RoleCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  color: string;
  onClick: () => void;
}

interface HeaderProps {
  title: string;
  setRole: RoleSetter;
}

interface MenuItemCardProps {
  item: MenuItem;
  qty: number;
  onUpdate: (delta: number) => void;
}

interface TabletButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface CashierViewProps {
  setRole: RoleSetter;
  menu: MenuDefinition;
}

interface CookerViewProps {
  setRole: RoleSetter;
  orders: Order[];
  inventory: InventoryState;
  menu: MenuDefinition;
}

interface ServerViewProps {
  setRole: RoleSetter;
  orders: Order[];
  inventory: InventoryState;
  menu: MenuDefinition;
}

interface OrderCardProps {
  order: Order;
  number: number;
  onServe: () => void;
  processing: boolean;
  menu: MenuDefinition;
}

interface ManagerViewProps {
  setRole: RoleSetter;
  menu: MenuDefinition;
}

interface HistoryViewProps {
  setRole: RoleSetter;
  orders: Order[];
  menu: MenuDefinition;
}

type InventoryUpdater = (
  item: InventoryEntry
) => InventoryEntry;

// ============================================================
// Error helpers
// ============================================================

function getErrorMessage(
  error: unknown,
  fallback = 'An unexpected error occurred.'
): string {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}

// ============================================================
// Firebase configuration
// ============================================================

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasValidFirebaseConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

if (!hasValidFirebaseConfig) {
  throw new Error(
    'Firebase configuration is missing. Check your .env.local file.',
  );
}

const app = initializeApp(firebaseConfig);

const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

const appId =
  typeof window !== 'undefined' && window.__app_id
    ? window.__app_id
    : 'demo-dimsum-app';

function requireDb(): Firestore {
  if (!db) {
    throw new Error(
      'Firebase is not configured. Please check your Firebase configuration.'
    );
  }

  return db;
}

function getOrdersRef() {
  return collection(
    requireDb(),
    'artifacts',
    appId,
    'public',
    'data',
    'orders'
  );
}

function getInventoryRef(): DocumentReference<DocumentData> {
  return doc(
    requireDb(),
    'artifacts',
    appId,
    'public',
    'data',
    'inventory',
    'main'
  );
}

function getMenuRef(): DocumentReference<DocumentData> {
  return doc(
    requireDb(),
    'artifacts',
    appId,
    'public',
    'data',
    'menu',
    'main'
  );
}

// ============================================================
// Default menu
// ============================================================

const DEFAULT_MENU = {
  base: {
    chickenCheeseRoll: {
      id: 'chickenCheeseRoll',
      name: 'Chicken Cheese Roll',
      price: 15000,
      color: 'bg-yellow-100 text-yellow-800',
    },
    chickenDumpling: {
      id: 'chickenDumpling',
      name: 'Chicken Dumpling',
      price: 12000,
      color: 'bg-orange-100 text-orange-800',
    },
    cheeseDimsum: {
      id: 'cheeseDimsum',
      name: 'Cheese Dimsum',
      price: 14000,
      color: 'bg-amber-100 text-amber-800',
    },
    soup: {
      id: 'soup',
      name: 'Soup',
      price: 10000,
      color: 'bg-red-100 text-red-800',
    },
  },
  combos: {
    dimSoup: {
      id: 'dimSoup',
      name: 'Dim Soup Combo',
      price: 45000,
      desc: '1 Roll + 1 Dumpling + 1 Soup',
      color: 'bg-indigo-100 text-indigo-800',
      contains: {
        chickenCheeseRoll: 1,
        chickenDumpling: 1,
        soup: 1,
      },
    },
  },
} satisfies MenuDefinition;

// ============================================================
// Default inventory and menu utilities
// ============================================================

function getDefaultInventory(
  menuBase: MenuBase
): InventoryState {
  const inventory: InventoryState = {};

  for (const key of Object.keys(menuBase)) {
    inventory[key] = {
      batches: [],
      ready: 0,
    };
  }

  return inventory;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function getMenuItem(
  menu: MenuDefinition | null | undefined,
  id: string
): MenuItem | null {
  return menu?.base?.[id] ?? menu?.combos?.[id] ?? null;
}

function getMenuItemName(
  menu: MenuDefinition | null | undefined,
  id: string
): string {
  return getMenuItem(menu, id)?.name ?? id;
}

function getMenuItemColor(
  menu: MenuDefinition | null | undefined,
  id: string
): string {
  return (
    getMenuItem(menu, id)?.color ??
    'bg-gray-100 text-gray-800'
  );
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value > 0
  );
}

function isNonNegativeNumber(
  value: unknown
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

// ============================================================
// Runtime data validation
// ============================================================

function validateMenu(menu: unknown): asserts menu is MenuDefinition {
  if (
    !isRecord(menu) ||
    !isRecord(menu.base) ||
    !isRecord(menu.combos)
  ) {
    throw new Error('Invalid menu structure.');
  }

  for (const [key, item] of Object.entries({
    ...menu.base,
    ...menu.combos,
  })) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id.trim().length === 0 ||
      typeof item.name !== 'string' ||
      item.name.trim().length === 0 ||
      !isNonNegativeNumber(item.price)
    ) {
      throw new Error(
        `Menu item "${key}" needs a name and a valid price.`
      );
    }

    if (
      item.color !== undefined &&
      typeof item.color !== 'string'
    ) {
      throw new Error(`Invalid color for menu item "${key}".`);
    }

    if (
      item.available !== undefined &&
      typeof item.available !== 'boolean'
    ) {
      throw new Error(
        `Invalid availability for menu item "${key}".`
      );
    }
  }

  for (const [key, item] of Object.entries(menu.base)) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id !== key
    ) {
      throw new Error(
        `Base menu key "${key}" does not match its item ID.`
      );
    }
  }

  for (const [key, combo] of Object.entries(menu.combos)) {
    if (
      !isRecord(combo) ||
      typeof combo.id !== 'string' ||
      combo.id !== key
    ) {
      throw new Error(
        `Combo key "${key}" does not match its item ID.`
      );
    }

    if (combo.desc !== undefined && typeof combo.desc !== 'string') {
      throw new Error(`Invalid description for combo "${key}".`);
    }

    if (combo.contains !== undefined) {
      if (!isRecord(combo.contains)) {
        throw new Error(
          `Invalid contents for combo "${combo.name}".`
        );
      }

      for (const [baseId, quantity] of Object.entries(
        combo.contains
      )) {
        if (
          !menu.base[baseId] ||
          !isPositiveInteger(quantity)
        ) {
          throw new Error(
            `Invalid item configuration in combo "${combo.name}".`
          );
        }
      }
    }
  }
}

function parseQuantityMap(value: unknown): QuantityMap {
  if (!isRecord(value)) {
    throw new Error('Invalid order items.');
  }

  const result: QuantityMap = {};

  for (const [id, quantity] of Object.entries(value)) {
    if (!isPositiveInteger(quantity)) {
      throw new Error(`Invalid quantity for "${id}".`);
    }

    result[id] = quantity;
  }

  return result;
}

function parseItemDetails(
  value: unknown
): Record<string, OrderItemDetails> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new Error('Invalid order item details.');
  }

  const result: Record<string, OrderItemDetails> = {};

  for (const [id, details] of Object.entries(value)) {
    if (
      !isRecord(details) ||
      typeof details.name !== 'string' ||
      !isNonNegativeNumber(details.price) ||
      !isPositiveInteger(details.quantity)
    ) {
      throw new Error(`Invalid details for order item "${id}".`);
    }

    result[id] = {
      name: details.name,
      price: details.price,
      quantity: details.quantity,
    };
  }

  return result;
}

function parseOrder(
  id: string,
  value: unknown
): Order {
  if (
    !isRecord(value) ||
    !isNonNegativeNumber(value.totalPrice) ||
    typeof value.status !== 'string' ||
    !isNonNegativeNumber(value.timestamp)
  ) {
    throw new Error(`Order "${id}" has invalid data.`);
  }

  if (
    value.customerName !== undefined &&
    typeof value.customerName !== 'string'
  ) {
    throw new Error(`Order "${id}" has an invalid customer name.`);
  }

  if (
    value.servedAt !== undefined &&
    !isNonNegativeNumber(value.servedAt)
  ) {
    throw new Error(`Order "${id}" has an invalid served timestamp.`);
  }

  return {
    id,
    items: parseQuantityMap(value.items),
    itemDetails: parseItemDetails(value.itemDetails),
    customerName: value.customerName,
    totalPrice: value.totalPrice,
    status: value.status,
    timestamp: value.timestamp,
    servedAt: value.servedAt,
  };
}

function parseInventoryEntry(value: unknown): InventoryEntry {
  if (
    !isRecord(value) ||
    !isNonNegativeNumber(value.ready) ||
    !Array.isArray(value.batches)
  ) {
    throw new Error('Invalid inventory entry.');
  }

  const batches: InventoryBatch[] = value.batches.map(
    (batch: unknown) => {
      if (
        !isRecord(batch) ||
        typeof batch.id !== 'string' ||
        !isPositiveInteger(batch.qty) ||
        !isNonNegativeNumber(batch.timestamp)
      ) {
        throw new Error('Invalid inventory batch.');
      }

      return {
        id: batch.id,
        qty: batch.qty,
        timestamp: batch.timestamp,
      };
    }
  );

  return {
    ready: value.ready,
    batches,
  };
}

function parseInventory(value: unknown): InventoryState {
  if (!isRecord(value)) {
    throw new Error('Invalid inventory data.');
  }

  const result: InventoryState = {};

  for (const [id, entry] of Object.entries(value)) {
    result[id] = parseInventoryEntry(entry);
  }

  return result;
}

// ============================================================
// Main application
// ============================================================

export default function DimsumApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [role, setRole] = useState<Role | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryState>({});
  const [menu, setMenu] = useState<MenuDefinition>(DEFAULT_MENU);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthError(
        'Firebase configuration is missing or invalid.'
      );
      setAuthLoading(false);
      return;
    }

    let active = true;

    const unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        if (!active) return;

        setUser(currentUser);
        setAuthLoading(false);
      },
      (error) => {
        if (!active) return;

        setAuthError(error.message);
        setAuthLoading(false);
      }
    );

    const initializeAuth = async (): Promise<void> => {
      try {
        if (!active) return;

        if (window.__initial_auth_token) {
          await signInWithCustomToken(
            auth,
            window.__initial_auth_token
          );
        } else {
          await signInAnonymously(auth);
        }
      } catch (error: unknown) {
        console.error('Authentication error:', error);

        if (active) {
          setAuthError(
            getErrorMessage(error, 'Authentication failed.')
          );
          setAuthLoading(false);
        }
      }
    };

    void initializeAuth();

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || !db) return;

    let active = true;

    const unsubOrders = onSnapshot(
      getOrdersRef(),
      (snapshot) => {
        try {
          const fetchedOrders = snapshot.docs.map((orderDoc) =>
            parseOrder(orderDoc.id, orderDoc.data())
          );

          fetchedOrders.sort(
            (a, b) => b.timestamp - a.timestamp
          );

          if (active) {
            setOrders(fetchedOrders);
            setDataError(null);
          }
        } catch (error: unknown) {
          console.error('Invalid order data:', error);

          if (active) {
            setDataError(
              getErrorMessage(error, 'Invalid order data.')
            );
          }
        }
      },
      (error) => {
        console.error('Order sync error:', error);

        if (active) {
          setDataError(error.message);
        }
      }
    );

    const unsubInventory = onSnapshot(
      getInventoryRef(),
      async (snapshot) => {
        if (snapshot.exists()) {
          try {
            const parsedInventory = parseInventory(snapshot.data());

            if (active) {
              setInventory(parsedInventory);
              setDataError(null);
            }
          } catch (error: unknown) {
            console.error('Invalid inventory data:', error);

            if (active) {
              setDataError(
                getErrorMessage(error, 'Invalid inventory data.')
              );
            }
          }

          return;
        }

        try {
          await runTransaction(db, async (transaction) => {
            const ref = getInventoryRef();
            const latest = await transaction.get(ref);

            if (!latest.exists()) {
              transaction.set(
                ref,
                getDefaultInventory(DEFAULT_MENU.base)
              );
            }
          });
        } catch (error: unknown) {
          console.error('Inventory initialization error:', error);
        }
      },
      (error) => {
        console.error('Inventory sync error:', error);

        if (active) {
          setDataError(error.message);
        }
      }
    );

    const unsubMenu = onSnapshot(
      getMenuRef(),
      async (snapshot) => {
        if (snapshot.exists()) {
          try {
            const savedMenu: unknown = snapshot.data();

            validateMenu(savedMenu);

            if (active) {
              setMenu(savedMenu);
              setDataError(null);
            }
          } catch (error: unknown) {
            console.error('Invalid saved menu:', error);

            if (active) {
              setDataError(
                getErrorMessage(error, 'Invalid saved menu.')
              );
            }
          }

          return;
        }

        try {
          await runTransaction(db, async (transaction) => {
            const ref = getMenuRef();
            const latest = await transaction.get(ref);

            if (!latest.exists()) {
              transaction.set(ref, DEFAULT_MENU);
            }
          });
        } catch (error: unknown) {
          console.error('Menu initialization error:', error);
        }
      },
      (error) => {
        console.error('Menu sync error:', error);

        if (active) {
          setDataError(error.message);
        }
      }
    );

    return () => {
      active = false;
      unsubOrders();
      unsubInventory();
      unsubMenu();
    };
  }, [user]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-xl animate-pulse text-orange-600 font-semibold">
          Warming up the steamers...
        </p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-red-100 text-red-700 p-4 rounded-lg">
          <p className="font-bold">Connection error</p>
          <p>{authError}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-800">
      {dataError && (
        <div className="bg-red-50 border-b border-red-200 p-3 text-center text-sm text-red-700">
          {dataError}
        </div>
      )}

      {!role && <RoleSelection setRole={setRole} />}

      {role === 'cashier' && (
        <CashierView setRole={setRole} menu={menu} />
      )}

      {role === 'cooker' && (
        <CookerView
          setRole={setRole}
          orders={orders}
          inventory={inventory}
          menu={menu}
        />
      )}

      {role === 'server' && (
        <ServerView
          setRole={setRole}
          orders={orders}
          inventory={inventory}
          menu={menu}
        />
      )}

      {role === 'manager' && (
        <ManagerView setRole={setRole} menu={menu} />
      )}

      {role === 'history' && (
        <HistoryView
          setRole={setRole}
          orders={orders}
          menu={menu}
        />
      )}
    </div>
  );
}

// ============================================================
// Role selection
// ============================================================

function RoleSelection({ setRole }: RoleSelectionProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-extrabold text-orange-600 mb-2">
          Dimsum Hub
        </h1>
        <p className="text-slate-500">
          Select your station to begin
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 w-full max-w-4xl">
        <RoleCard
          icon={<Receipt size={48} />}
          title="Cashier"
          desc="Take orders and payments"
          color="bg-emerald-500"
          onClick={() => setRole('cashier')}
        />

        <RoleCard
          icon={<ChefHat size={48} />}
          title="Cooker"
          desc="Manage steamers and fryers"
          color="bg-orange-500"
          onClick={() => setRole('cooker')}
        />

        <RoleCard
          icon={<Utensils size={48} />}
          title="Server"
          desc="Package and deliver orders"
          color="bg-blue-500"
          onClick={() => setRole('server')}
        />

        <RoleCard
          icon={<Settings size={48} />}
          title="Manager"
          desc="Manage menu and pricing"
          color="bg-purple-500"
          onClick={() => setRole('manager')}
        />

        <RoleCard
          icon={<History size={48} />}
          title="History"
          desc="View past orders"
          color="bg-slate-700"
          onClick={() => setRole('history')}
        />
      </div>
    </div>
  );
}

function RoleCard({
  icon,
  title,
  desc,
  color,
  onClick,
}: RoleCardProps) {
  return (
    <button
      onClick={onClick}
      className={`${color} text-white p-8 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all flex flex-col items-center justify-center gap-4 active:scale-95`}
    >
      <div className="p-4 bg-white/20 rounded-full">{icon}</div>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-white/80 text-sm font-medium">{desc}</p>
    </button>
  );
}

// ============================================================
// Shared header
// ============================================================

function Header({ title, setRole }: HeaderProps) {
  return (
    <header className="bg-white shadow-sm sticky top-0 z-10 px-4 py-4 flex items-center justify-between">
      <button
        onClick={() => setRole(null)}
        aria-label="Back to station selection"
        className="flex items-center text-slate-500 hover:text-orange-600 active:scale-90 transition-transform"
      >
        <ArrowLeft size={24} />
      </button>

      <h1 className="text-xl font-bold text-slate-800">
        {title}
      </h1>

      <div className="w-6" />
    </header>
  );
}

// ============================================================
// Cashier
// ============================================================

function CashierView({ setRole, menu }: CashierViewProps) {
  const [currentOrder, setCurrentOrder] = useState<QuantityMap>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  const updateQty = (id: string, delta: number): void => {
    setCurrentOrder((prev) => {
      const newQty = (prev[id] ?? 0) + delta;

      if (newQty <= 0) {
        const { [id]: removed, ...rest } = prev;
        return rest;
      }

      return { ...prev, [id]: newQty };
    });
  };

  const totalItems = Object.values(currentOrder).reduce(
    (total, qty) => total + qty,
    0
  );

  const totalPrice = Object.entries(currentOrder).reduce(
    (total, [id, qty]) => {
      const item = getMenuItem(menu, id);
      return total + (item?.price ?? 0) * qty;
    },
    0
  );

  const submitOrder = async (): Promise<void> => {
    if (totalItems === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      validateMenu(menu);

      const items: QuantityMap = { ...currentOrder };

      const itemDetails: Record<string, OrderItemDetails> = {};

      for (const [id, qty] of Object.entries(items)) {
        const item = getMenuItem(menu, id);

        if (!item || !isPositiveInteger(qty)) {
          throw new Error(
            'Please check the selected menu items.'
          );
        }

        if (!isNonNegativeNumber(item.price)) {
          throw new Error(`Invalid price for ${item.name}.`);
        }

        itemDetails[id] = {
          name: item.name,
          price: item.price,
          quantity: qty,
        };
      }

      await addDoc(getOrdersRef(), {
        items,
        itemDetails,
        customerName: customerName.trim() || 'Guest',
        totalPrice,
        status: 'pending',
        timestamp: Date.now(),
      });

      setCurrentOrder({});
      setCustomerName('');
    } catch (error: unknown) {
      console.error('Failed to submit order:', error);
      setError(
        getErrorMessage(error, 'Failed to submit order.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen pb-28">
      <Header title="Cashier Terminal" setRole={setRole} />

      <main className="flex-1 p-4 max-w-lg mx-auto w-full space-y-6">
        {error && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg">
            {error}
          </div>
        )}

        <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
          <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">
            Customer Name
          </label>

          <input
            type="text"
            value={customerName}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setCustomerName(event.target.value)
            }
            placeholder="Enter customer name"
            maxLength={100}
            className="w-full text-lg p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
            Combos
          </h2>

          <div className="space-y-3">
            {Object.values(menu.combos).map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                qty={currentOrder[item.id] ?? 0}
                onUpdate={(delta) => updateQty(item.id, delta)}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
            A La Carte
          </h2>

          <div className="space-y-3">
            {Object.values(menu.base).map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                qty={currentOrder[item.id] ?? 0}
                onUpdate={(delta) => updateQty(item.id, delta)}
              />
            ))}
          </div>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
          <div className="text-slate-600 font-medium flex flex-col">
            <span>
              Items:{' '}
              <span className="text-orange-600 font-bold text-xl">
                {totalItems}
              </span>
            </span>

            <span className="text-sm">
              Total:{' '}
              <span className="text-emerald-600 font-bold">
                {formatCurrency(totalPrice)}
              </span>
            </span>
          </div>

          <button
            onClick={submitOrder}
            disabled={totalItems === 0 || isSubmitting}
            className="px-6 py-3 rounded-full font-bold text-white bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed active:scale-95 shadow-md"
          >
            {isSubmitting ? 'Sending...' : 'Send Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuItemCard({
  item,
  qty,
  onUpdate,
}: MenuItemCardProps) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-bold text-slate-800">{item.name}</h3>

        <span className="text-emerald-600 font-medium">
          {formatCurrency(item.price)}
        </span>

        {'desc' in item && item.desc && (
          <p className="text-xs text-slate-500 mt-1">
            {item.desc}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 bg-gray-50 rounded-full p-1 border border-gray-100 shrink-0">
        <button
          onClick={() => onUpdate(-1)}
          disabled={qty === 0}
          aria-label={`Decrease ${item.name}`}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white text-slate-600 shadow-sm disabled:opacity-50"
        >
          <Minus size={18} />
        </button>

        <span className="font-bold w-6 text-center">{qty}</span>

        <button
          onClick={() => onUpdate(1)}
          aria-label={`Increase ${item.name}`}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-orange-100 text-orange-600 shadow-sm"
        >
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Cooker
// ============================================================

function CookerView({
  setRole,
  orders,
  inventory,
  menu,
}: CookerViewProps) {
  const [cookInputs, setCookInputs] = useState<QuantityMap>({});
  const [busyItems, setBusyItems] = useState<BooleanMap>({});
  const [error, setError] = useState('');

  const neededStats = useMemo<QuantityMap>(() => {
    const stats: QuantityMap = {};

    for (const id of Object.keys(menu.base)) {
      stats[id] = 0;
    }

    for (const order of orders) {
      if (order.status !== 'pending') continue;

      for (const [itemId, qty] of Object.entries(order.items)) {
        if (menu.base[itemId]) {
          stats[itemId] = (stats[itemId] ?? 0) + qty;
        } else {
          const combo = menu.combos[itemId];

          if (!combo) continue;

          for (const [baseId, baseQty] of Object.entries(
            combo.contains ?? {}
          )) {
            stats[baseId] =
              (stats[baseId] ?? 0) + baseQty * qty;
          }
        }
      }
    }

    return stats;
  }, [orders, menu]);

  const handleInput = (itemId: string, delta: number): void => {
    setCookInputs((prev) => ({
      ...prev,
      [itemId]: Math.max(1, (prev[itemId] ?? 1) + delta),
    }));
  };

  const updateInventoryItem = async (
    itemId: string,
    updater: InventoryUpdater
  ): Promise<void> => {
    if (busyItems[itemId]) return;

    setBusyItems((prev) => ({ ...prev, [itemId]: true }));
    setError('');

    try {
      await runTransaction(requireDb(), async (transaction) => {
        const inventoryRef = getInventoryRef();
        const snapshot = await transaction.get(inventoryRef);

        if (!snapshot.exists()) {
          throw new Error(
            'Inventory has not been initialized.'
          );
        }

        const rawInventory: unknown = snapshot.data();
        const currentInventory = parseInventory(rawInventory);

        const currentItem = currentInventory[itemId] ?? {
          ready: 0,
          batches: [],
        };

        const updatedItem = updater(currentItem);

        transaction.update(inventoryRef, {
          [itemId]: updatedItem,
        });
      });
    } catch (error: unknown) {
      console.error('Inventory update failed:', error);

      setError(
        getErrorMessage(error, 'Failed to update inventory.')
      );

      throw error;
    } finally {
      setBusyItems((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const startBatch = async (itemId: string): Promise<void> => {
    const qty = cookInputs[itemId] ?? 1;

    if (!isPositiveInteger(qty)) {
      setError('Batch quantity must be a positive integer.');
      return;
    }

    try {
      await updateInventoryItem(itemId, (itemData) => ({
        ...itemData,
        batches: [
          ...itemData.batches,
          {
            id: `${Date.now()}-${Math.random()
              .toString(36)
              .slice(2)}`,
            qty,
            timestamp: Date.now(),
          },
        ],
      }));

      setCookInputs((prev) => ({ ...prev, [itemId]: 1 }));
    } catch {
      // The error is displayed by updateInventoryItem.
    }
  };

  const markBatchReady = async (
    itemId: string,
    batchId: string,
    qty: number
  ): Promise<void> => {
    try {
      await updateInventoryItem(itemId, (itemData) => {
        const batch = itemData.batches.find(
          (entry) => entry.id === batchId
        );

        if (!batch) {
          throw new Error(
            'This batch has already been processed.'
          );
        }

        if (batch.qty !== qty) {
          throw new Error(
            'Batch quantity has changed. Please refresh.'
          );
        }

        return {
          ...itemData,
          batches: itemData.batches.filter(
            (entry) => entry.id !== batchId
          ),
          ready: itemData.ready + qty,
        };
      });
    } catch {
      // The error is displayed by updateInventoryItem.
    }
  };

  const adjustReadyManual = async (
    itemId: string,
    delta: number
  ): Promise<void> => {
    try {
      await updateInventoryItem(itemId, (itemData) => {
        const nextReady = itemData.ready + delta;

        if (nextReady < 0) {
          throw new Error('Ready stock cannot be negative.');
        }

        return {
          ...itemData,
          ready: nextReady,
        };
      });
    } catch {
      // The error is displayed by updateInventoryItem.
    }
  };

  const itemHeaderColors: Record<string, string> = {
    chickenCheeseRoll: 'bg-[#fcf7cd] text-[#714316]',
    chickenDumpling: 'bg-[#fdeed6] text-[#863813]',
    cheeseDimsum: 'bg-[#fef0c7] text-[#7a4100]',
    soup: 'bg-[#fee2e2] text-[#991b1b]',
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Kitchen Station" setRole={setRole} />

      <main className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full">
        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-6">
          {Object.values(menu.base).map((item) => {
            const needed = neededStats[item.id] ?? 0;

            const itemData = inventory[item.id] ?? {
              ready: 0,
              batches: [],
            };

            const ready = itemData.ready;
            const batches = itemData.batches;

            const cookingTotal = batches.reduce(
              (sum, batch) => sum + batch.qty,
              0
            );

            const isDeficit = needed > cookingTotal + ready;
            const inputValue = cookInputs[item.id] ?? 1;
            const isBusy = Boolean(busyItems[item.id]);

            return (
              <div
                key={item.id}
                className="bg-white rounded-[24px] shadow-sm border border-gray-200 overflow-hidden"
              >
                <div
                  className={`p-5 md:p-6 ${
                    itemHeaderColors[item.id] ??
                    'bg-slate-100 text-slate-800'
                  } flex justify-between items-center gap-4`}
                >
                  <h2 className="text-xl md:text-2xl font-bold">
                    {item.name}
                  </h2>

                  <div className="bg-white px-5 py-2 rounded-2xl shadow-sm flex flex-col items-center min-w-[80px]">
                    <div className="text-[11px] uppercase font-bold text-[#b58c70] mb-1 tracking-wider">
                      Needed
                    </div>

                    <div
                      className={`text-3xl md:text-4xl font-black ${
                        isDeficit
                          ? 'text-red-600'
                          : 'text-slate-800'
                      }`}
                    >
                      {needed}
                    </div>
                  </div>
                </div>

                <div className="p-4 md:p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
                    <div className="bg-[#fdf8e6] rounded-2xl p-6 flex flex-col border border-amber-50 justify-between">
                      <span className="text-[#965e23] font-bold uppercase text-[13px] mb-4 tracking-wider text-center">
                        Setup New Batch
                      </span>

                      <div className="flex items-center justify-center gap-4 mb-6">
                        <TabletButton
                          onClick={() =>
                            handleInput(item.id, -1)
                          }
                          icon={<Minus size={32} />}
                          disabled={inputValue <= 1 || isBusy}
                        />

                        <span className="text-5xl font-black text-[#6b4216] w-20 text-center">
                          {inputValue}
                        </span>

                        <TabletButton
                          onClick={() =>
                            handleInput(item.id, 1)
                          }
                          icon={<Plus size={32} />}
                          disabled={isBusy}
                        />
                      </div>

                      <button
                        onClick={() => void startBatch(item.id)}
                        disabled={isBusy}
                        className="w-full bg-[#242b3d] hover:bg-[#1a1f2c] disabled:opacity-50 text-white py-4 rounded-[16px] font-bold text-lg flex items-center justify-center gap-2 shadow-md"
                      >
                        <Play size={20} fill="currentColor" />
                        {isBusy
                          ? 'Processing...'
                          : 'Steam / Fry Now'}
                      </button>
                    </div>

                    <div className="bg-[#ebfbf3] rounded-2xl p-6 flex flex-col items-center justify-center border border-emerald-50">
                      <span className="text-[#0d6e42] font-bold uppercase text-[13px] mb-4 tracking-wider">
                        Total Ready
                      </span>

                      <span className="text-6xl font-black text-[#0f5132] mb-6">
                        {ready}
                      </span>

                      <div className="flex gap-3">
                        <button
                          onClick={() =>
                            void adjustReadyManual(item.id, -1)
                          }
                          disabled={isBusy || ready <= 0}
                          className="px-3 py-2 bg-white rounded-lg text-slate-600 shadow-sm border disabled:opacity-40 flex items-center gap-1"
                        >
                          <Minus size={16} />
                          Adjust
                        </button>

                        <button
                          onClick={() =>
                            void adjustReadyManual(item.id, 1)
                          }
                          disabled={isBusy}
                          className="px-3 py-2 bg-white rounded-lg text-slate-600 shadow-sm border disabled:opacity-40 flex items-center gap-1"
                        >
                          <Plus size={16} />
                          Adjust
                        </button>
                      </div>
                    </div>
                  </div>

                  {batches.length > 0 && (
                    <div className="bg-slate-50 rounded-2xl p-4 md:p-6 border border-slate-100">
                      <h3 className="text-slate-500 font-bold uppercase text-xs mb-4 tracking-wider flex items-center gap-2">
                        <Flame size={16} />
                        Active Batches ({cookingTotal} cooking)
                      </h3>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {batches.map((batch, index) => (
                          <div
                            key={batch.id}
                            className="bg-white p-3 rounded-xl shadow-sm border border-amber-100 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3">
                              <span className="bg-amber-100 text-amber-800 font-black text-xl w-10 h-10 flex items-center justify-center rounded-lg">
                                {batch.qty}
                              </span>

                              <div className="text-xs font-semibold text-slate-500">
                                Batch #{index + 1}
                              </div>
                            </div>

                            <button
                              onClick={() =>
                                void markBatchReady(
                                  item.id,
                                  batch.id,
                                  batch.qty
                                )
                              }
                              disabled={isBusy}
                              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1"
                            >
                              <CheckCircle size={16} />
                              Ready
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function TabletButton({
  onClick,
  icon,
  disabled = false,
}: TabletButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-[72px] h-[72px] rounded-[20px] flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 shadow-sm bg-white text-slate-500 border-[3px] border-gray-100 hover:border-gray-200"
    >
      {icon}
    </button>
  );
}

// ============================================================
// Server
// ============================================================

function ServerView({
  setRole,
  orders,
  inventory: _inventory,
  menu,
}: ServerViewProps) {
  const [processingOrders, setProcessingOrders] =
    useState<BooleanMap>({});
  const [error, setError] = useState('');

  const pendingOrders = orders.filter(
    (order) => order.status === 'pending'
  );

  const serveOrder = async (order: Order): Promise<void> => {
    if (processingOrders[order.id]) return;

    setProcessingOrders((prev) => ({
      ...prev,
      [order.id]: true,
    }));

    setError('');

    try {
      await runTransaction(requireDb(), async (transaction) => {
        const orderRef = doc(getOrdersRef(), order.id);
        const inventoryRef = getInventoryRef();

        const [orderSnapshot, inventorySnapshot] =
          await Promise.all([
            transaction.get(orderRef),
            transaction.get(inventoryRef),
          ]);

        if (!orderSnapshot.exists()) {
          throw new Error('Order not found.');
        }

        if (!inventorySnapshot.exists()) {
          throw new Error(
            'Inventory has not been initialized.'
          );
        }

        const latestOrder = parseOrder(
          orderSnapshot.id,
          orderSnapshot.data()
        );

        if (latestOrder.status !== 'pending') {
          throw new Error(
            'This order has already been processed.'
          );
        }

        const latestInventory = parseInventory(
          inventorySnapshot.data()
        );

        const requiredBaseItems: QuantityMap = {};

        for (const [itemId, qty] of Object.entries(
          latestOrder.items
        )) {
          if (!isPositiveInteger(qty)) {
            throw new Error(`Invalid quantity for ${itemId}.`);
          }

          if (menu.base[itemId]) {
            requiredBaseItems[itemId] =
              (requiredBaseItems[itemId] ?? 0) + qty;

            continue;
          }

          const combo = menu.combos[itemId];

          if (combo) {
            for (const [baseId, baseQty] of Object.entries(
              combo.contains ?? {}
            )) {
              if (
                !menu.base[baseId] ||
                !isPositiveInteger(baseQty)
              ) {
                throw new Error(
                  `Invalid combo item: ${baseId}.`
                );
              }

              requiredBaseItems[baseId] =
                (requiredBaseItems[baseId] ?? 0) +
                baseQty * qty;
            }

            continue;
          }

          throw new Error(`Unknown menu item: ${itemId}.`);
        }

        const updatedInventory: InventoryState = {
          ...latestInventory,
        };

        // Validate every item before committing writes.
        for (const [baseId, neededQty] of Object.entries(
          requiredBaseItems
        )) {
          const menuItem = menu.base[baseId];
          const itemData = latestInventory[baseId];

          if (!itemData) {
            throw new Error(
              `Inventory for ${menuItem.name} is missing.`
            );
          }

          if (itemData.ready < neededQty) {
            throw new Error(
              `Not enough ${menuItem.name}. ` +
                `Required: ${neededQty}, available: ${itemData.ready}.`
            );
          }

          updatedInventory[baseId] = {
            ...itemData,
            ready: itemData.ready - neededQty,
          };
        }

        transaction.set(inventoryRef, updatedInventory);

        transaction.update(orderRef, {
          status: 'served',
          servedAt: Date.now(),
        });
      });
    } catch (error: unknown) {
      console.error('Failed to serve order:', error);

      setError(
        getErrorMessage(error, 'Failed to serve order.')
      );
    } finally {
      setProcessingOrders((prev) => ({
        ...prev,
        [order.id]: false,
      }));
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Server Station" setRole={setRole} />

      <main className="flex-1 p-4 max-w-lg mx-auto w-full">
        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-lg">
            {error}
          </div>
        )}

        {pendingOrders.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center text-slate-400">
            <CheckCircle size={64} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">
              No pending orders!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pendingOrders.map((order, index) => (
              <OrderCard
                key={order.id}
                order={order}
                number={pendingOrders.length - index}
                onServe={() => void serveOrder(order)}
                processing={Boolean(
                  processingOrders[order.id]
                )}
                menu={menu}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function OrderCard({
  order,
  number,
  onServe,
  processing,
  menu,
}: OrderCardProps) {
  const [now, setNow] = useState<number>(Date.now());

  useEffect(() => {
    const interval = window.setInterval(
      () => setNow(Date.now()),
      30000
    );

    return () => window.clearInterval(interval);
  }, []);

  const timeWaiting = Math.max(
    0,
    Math.floor((now - order.timestamp) / 60000)
  );

  const orderNumber = order.id.slice(-4).toUpperCase();

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-200">
      <div className="flex justify-between items-start gap-3 mb-4 border-b border-gray-100 pb-3">
        <div className="min-w-0">
          <h3 className="font-black text-xl text-slate-800">
            {order.customerName || 'Guest'}
          </h3>

          <div className="text-sm font-bold text-slate-400 mt-1">
            Order #{orderNumber}
          </div>

          <div className="flex items-center text-xs text-slate-500 mt-1 gap-1">
            <Clock size={12} />
            {timeWaiting === 0
              ? 'Just now'
              : `${timeWaiting} min ago`}
          </div>
        </div>

        <button
          onClick={onServe}
          disabled={processing}
          className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white px-5 py-2 rounded-full font-bold shadow-md shrink-0"
        >
          {processing ? 'Serving...' : 'Serve'}
        </button>
      </div>

      <div className="space-y-2">
        {Object.entries(order.items).map(([itemId, qty]) => (
          <div key={itemId} className="flex items-center gap-3">
            <span className="font-black text-lg w-10 text-center text-slate-500 bg-slate-50 rounded-lg py-1">
              {qty}x
            </span>

            <span
              className={`px-3 py-1 rounded-full text-sm font-semibold ${getMenuItemColor(
                menu,
                itemId
              )}`}
            >
              {getMenuItemName(menu, itemId)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm">
        <span className="text-slate-500">
          Queue #{number}
        </span>

        <span className="font-bold text-emerald-600">
          {formatCurrency(order.totalPrice)}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// Manager / menu editor
// ============================================================

function ManagerView({ setRole, menu }: ManagerViewProps) {
  const [localMenu, setLocalMenu] =
    useState<MenuDefinition>(menu);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] =
    useState<'success' | 'error'>('success');

  useEffect(() => {
    setLocalMenu(menu);
  }, [menu]);

  const updateBaseItem = (
    id: string,
    field: 'name' | 'price',
    value: string | number
  ): void => {
    setLocalMenu((prev) => {
      const item = prev.base[id];

      if (!item) return prev;

      return {
        ...prev,
        base: {
          ...prev.base,
          [id]: {
            ...item,
            [field]:
              field === 'price'
                ? typeof value === 'number'
                  ? value
                  : Number(value)
                : String(value),
          },
        },
      };
    });
  };

  const updateComboItem = (
    id: string,
    field: 'name' | 'price' | 'desc',
    value: string | number
  ): void => {
    setLocalMenu((prev) => {
      const item = prev.combos[id];

      if (!item) return prev;

      return {
        ...prev,
        combos: {
          ...prev.combos,
          [id]: {
            ...item,
            [field]:
              field === 'price'
                ? typeof value === 'number'
                  ? value
                  : Number(value)
                : String(value),
          },
        },
      };
    });
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;

    setSaving(true);
    setMessage('');

    try {
      validateMenu(localMenu);

      const normalizedMenu: MenuDefinition = {
        base: Object.fromEntries(
          Object.entries(localMenu.base).map(([id, item]) => [
            id,
            {
              ...item,
              name: item.name.trim(),
              price: Number(item.price),
            },
          ])
        ),
        combos: Object.fromEntries(
          Object.entries(localMenu.combos).map(([id, item]) => [
            id,
            {
              ...item,
              name: item.name.trim(),
              desc: item.desc ?? '',
              price: Number(item.price),
            },
          ])
        ),
      };

      await runTransaction(requireDb(), async (transaction) => {
        const menuRef = getMenuRef();
        const snapshot = await transaction.get(menuRef);

        if (!snapshot.exists()) {
          throw new Error(
            'Menu has not been initialized. Please try again.'
          );
        }

        transaction.set(menuRef, normalizedMenu);
      });

      setLocalMenu(normalizedMenu);
      setMessageType('success');
      setMessage('Menu saved successfully!');
    } catch (error: unknown) {
      console.error('Error saving menu:', error);

      setMessageType('error');
      setMessage(
        getErrorMessage(error, 'Failed to save menu.')
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen pb-28">
      <Header title="Menu Management" setRole={setRole} />

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-8 mt-4">
        {message && (
          <div
            className={`p-4 rounded-xl text-center font-bold ${
              messageType === 'success'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {message}
          </div>
        )}

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-800 border-b pb-2">
            A La Carte Items
          </h2>

          {Object.values(localMenu.base).map((item) => (
            <div
              key={item.id}
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3"
            >
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-bold text-slate-500 uppercase">
                    Name
                  </label>

                  <input
                    type="text"
                    value={item.name}
                    maxLength={100}
                    onChange={(
                      event: React.ChangeEvent<HTMLInputElement>
                    ) =>
                      updateBaseItem(
                        item.id,
                        'name',
                        event.target.value
                      )
                    }
                    className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div className="w-1/3">
                  <label className="block text-xs font-bold text-slate-500 uppercase">
                    Price (Rp)
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={item.price}
                    onChange={(
                      event: React.ChangeEvent<HTMLInputElement>
                    ) =>
                      updateBaseItem(
                        item.id,
                        'price',
                        event.target.value === ''
                          ? 0
                          : Number(event.target.value)
                      )
                    }
                    className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-800 border-b pb-2">
            Combos
          </h2>

          {Object.values(localMenu.combos).map((combo) => (
            <div
              key={combo.id}
              className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 space-y-3"
            >
              <div className="flex gap-4">
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-bold text-slate-500 uppercase">
                    Combo Name
                  </label>

                  <input
                    type="text"
                    value={combo.name}
                    maxLength={100}
                    onChange={(
                      event: React.ChangeEvent<HTMLInputElement>
                    ) =>
                      updateComboItem(
                        combo.id,
                        'name',
                        event.target.value
                      )
                    }
                    className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div className="w-1/3">
                  <label className="block text-xs font-bold text-slate-500 uppercase">
                    Price (Rp)
                  </label>

                  <input
                    type="number"
                    min="0"
                    step="500"
                    value={combo.price}
                    onChange={(
                      event: React.ChangeEvent<HTMLInputElement>
                    ) =>
                      updateComboItem(
                        combo.id,
                        'price',
                        event.target.value === ''
                          ? 0
                          : Number(event.target.value)
                      )
                    }
                    className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase">
                  Description / Details
                </label>

                <input
                  type="text"
                  value={combo.desc ?? ''}
                  maxLength={250}
                  onChange={(
                    event: React.ChangeEvent<HTMLInputElement>
                  ) =>
                    updateComboItem(
                      combo.id,
                      'desc',
                      event.target.value
                    )
                  }
                  className="w-full mt-1 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="text-sm text-slate-500">
                Contains:{' '}
                {Object.entries(combo.contains ?? {})
                  .map(
                    ([id, qty]) =>
                      `${qty} × ${getMenuItemName(localMenu, id)}`
                  )
                  .join(', ')}
              </div>
            </div>
          ))}
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-lg z-20">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="w-full py-4 rounded-xl font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 active:scale-95 shadow-md flex items-center justify-center gap-2"
          >
            <Save size={20} />
            {saving ? 'Saving...' : 'Save Menu Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Order history
// ============================================================

function HistoryView({
  setRole,
  orders,
  menu,
}: HistoryViewProps) {
  const pastOrders = orders.filter(
    (order) => order.status !== 'pending'
  );

  const getHistoricalItemName = (
    order: Order,
    itemId: string
  ): string =>
    order.itemDetails?.[itemId]?.name ??
    getMenuItemName(menu, itemId);

  const getHistoricalPrice = (
    order: Order,
    itemId: string
  ): number => {
    const details = order.itemDetails?.[itemId];

    if (details && isNonNegativeNumber(details.price)) {
      return details.price;
    }

    return getMenuItem(menu, itemId)?.price ?? 0;
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Order History" setRole={setRole} />

      <main className="flex-1 p-4 max-w-2xl mx-auto w-full space-y-4 mt-4">
        {pastOrders.length === 0 ? (
          <div className="mt-20 flex flex-col items-center justify-center text-slate-400">
            <History size={64} className="mb-4 text-gray-300" />
            <p className="text-lg font-medium">
              No past orders yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pastOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-xl p-4 shadow-sm border border-gray-200"
              >
                <div className="flex justify-between items-start gap-3 mb-3 border-b border-gray-100 pb-3">
                  <div className="min-w-0">
                    <h3 className="font-black text-lg text-slate-800">
                      {order.customerName || 'Guest'}
                    </h3>

                    <div className="text-sm font-bold text-slate-400 mt-1">
                      Order #{order.id.slice(-4).toUpperCase()}
                    </div>

                    <div className="text-xs text-slate-500 mt-1">
                      {order.timestamp
                        ? new Date(
                            order.timestamp
                          ).toLocaleString('id-ID')
                        : 'Unknown date'}
                    </div>

                    {order.servedAt !== undefined && (
                      <div className="text-xs text-slate-500 mt-1">
                        Served:{' '}
                        {new Date(
                          order.servedAt
                        ).toLocaleString('id-ID')}
                      </div>
                    )}
                  </div>

                  <div className="text-right flex flex-col items-end shrink-0">
                    <span
                      className={`inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full mb-2 ${
                        order.status === 'served'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {order.status}
                    </span>

                    <div className="font-black text-emerald-600">
                      {formatCurrency(order.totalPrice)}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {Object.entries(order.items).map(
                    ([itemId, qty]) => (
                      <div
                        key={itemId}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <div>
                          <span className="font-medium text-slate-600">
                            {getHistoricalItemName(order, itemId)}
                          </span>

                          <span className="text-slate-400 ml-2">
                            × {qty}
                          </span>
                        </div>

                        <span className="font-semibold text-slate-600 shrink-0">
                          {formatCurrency(
                            getHistoricalPrice(order, itemId) * qty
                          )}
                        </span>
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
