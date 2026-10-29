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

import { initializeApp, getApps, getApp, FirebaseOptions } from 'firebase/app';
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
  collection,
  onSnapshot,
  addDoc,
  runTransaction,
} from 'firebase/firestore';

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

const hasValidFirebaseConfig = Boolean(
  firebaseConfig?.apiKey &&
  firebaseConfig?.projectId &&
  firebaseConfig?.appId &&
  !firebaseConfig.apiKey.includes('YOUR_')
);

const app = hasValidFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

const appId =
  typeof window !== 'undefined' && window.__app_id
    ? window.__app_id
    : 'demo-dimsum-app';

function requireDb() {
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

function getInventoryRef() {
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

function getMenuRef() {
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
// Menu configuration
// Prices are in Indonesian rupiah.
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

type MenuItem = MenuItemBase & { desc?: string; contains?: Record<string, number> };
type MenuBase = Record<string, MenuItemBase>;

interface MenuDefinition {
  base: MenuBase;
  combos: Record<string, MenuComboItem>;
}

type AppRole = 'cashier' | 'cooker' | 'server' | 'manager' | 'history';
type OrderStatus = 'pending' | 'served' | (string & {});

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

interface RoleSelectionProps { setRole: (role: AppRole | null) => void }
interface HeaderProps { title: string; setRole: (role: AppRole | null) => void }
interface RoleCardProps { icon: React.ReactNode; title: string; desc: string; color: string; onClick: () => void }
interface CashierViewProps { setRole: HeaderProps['setRole']; menu: MenuDefinition }
interface MenuItemCardProps { item: MenuItem; qty: number; onUpdate: (delta: number) => void }
interface CookerViewProps { setRole: HeaderProps['setRole']; orders: Order[]; inventory: InventoryState; menu: MenuDefinition }
interface TabletButtonProps { onClick: () => void; icon: React.ReactNode; disabled?: boolean }
interface ServerViewProps { setRole: HeaderProps['setRole']; orders: Order[]; inventory: InventoryState; menu: MenuDefinition }
interface OrderCardProps { order: Order; number: number; onServe: () => void; processing: boolean; menu: MenuDefinition }
interface ManagerViewProps { setRole: HeaderProps['setRole']; menu: MenuDefinition }
interface HistoryViewProps { setRole: HeaderProps['setRole']; orders: Order[]; menu: MenuDefinition }

const getDefaultInventory = (menuBase: MenuBase): InventoryState =>
  Object.keys(menuBase).reduce<InventoryState>((acc, key) => {
    acc[key] = {
      batches: [],
      ready: 0,
    };

    return acc;
  }, {});

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);

const getMenuItem = (
  menu: MenuDefinition | null | undefined,
  id: string
): MenuItem | null => menu?.base?.[id] || menu?.combos?.[id] || null;

const getMenuItemName = (
  menu: MenuDefinition | null | undefined,
  id: string
): string => getMenuItem(menu, id)?.name || id;

const getMenuItemColor = (
  menu: MenuDefinition | null | undefined,
  id: string
): string => getMenuItem(menu, id)?.color || 'bg-gray-100 text-gray-800';

function validateMenu(menu: MenuDefinition): void {
  if (
    !menu ||
    typeof menu !== 'object' ||
    !menu.base ||
    !menu.combos ||
    typeof menu.base !== 'object' ||
    typeof menu.combos !== 'object'
  ) {
    throw new Error('Invalid menu structure.');
  }

  for (const item of Object.values({
    ...menu.base,
    ...menu.combos,
  })) {
    if (
      !item.id ||
      !item.name?.trim() ||
      !Number.isFinite(Number(item.price)) ||
      Number(item.price) < 0
    ) {
      throw new Error('Menu items need a name and a valid price.');
    }
  }

  for (const combo of Object.values(menu.combos)) {
    for (const [baseId, quantity] of Object.entries(
      combo.contains || {}
    )) {
      if (
        !menu.base[baseId] ||
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        throw new Error(
          `Invalid item configuration in combo "${combo.name}".`
        );
      }
    }
  }
}

// ============================================================
// Main application
// ============================================================

export default function DimsumApp() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [role, setRole] = useState<AppRole | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryState>({});
  const [menu, setMenu] = useState<MenuDefinition>(DEFAULT_MENU);
  const [authError, setAuthError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  // Authenticate with Firebase.
  useEffect(() => {
    if (!auth) {
      setAuthError('Firebase configuration is missing or invalid.');
      setAuthLoading(false);
      return;
    }

    let unsubscribe = () => { };

    unsubscribe = onAuthStateChanged(
      auth,
      (currentUser) => {
        setUser(currentUser);
        setAuthLoading(false);
      },
      (error) => {
        setAuthError(error.message);
        setAuthLoading(false);
      }
    );

    const initializeAuth = async () => {
      try {
        if (
          typeof window !== 'undefined' &&
          window.__initial_auth_token
        ) {
          await signInWithCustomToken(
            auth,
            window.__initial_auth_token
          );
        } else {
          await signInAnonymously(auth);
        }
      } catch (error: unknown) {
        console.error('Authentication error:', error);
        setAuthError(error instanceof Error ? error.message : 'Authentication failed.');
        setAuthLoading(false);
      }
    };

    initializeAuth();

    return () => unsubscribe();
  }, []);

  // Subscribe to shared Firestore data.
  useEffect(() => {
    if (!user || !db) return;

    let active = true;

    const unsubOrders = onSnapshot(
      getOrdersRef(),
      (snapshot) => {
        const fetchedOrders: Order[] = snapshot.docs.map((orderDoc) => {
          const data = orderDoc.data();
          return {
            id: orderDoc.id,
            items: (data.items ?? {}) as Record<string, number>,
            itemDetails: data.itemDetails as Record<string, OrderItemDetails> | undefined,
            customerName: data.customerName as string | undefined,
            totalPrice: Number(data.totalPrice ?? 0),
            status: String(data.status ?? 'pending'),
            timestamp: Number(data.timestamp ?? 0),
            servedAt: data.servedAt === undefined ? undefined : Number(data.servedAt),
          };
        });

        fetchedOrders.sort(
          (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
        );

        if (active) {
          setOrders(fetchedOrders);
          setDataError(null);
        }
      },
      (error) => {
        console.error('Order sync error:', error);
        if (active) {
          setDataError(error instanceof Error ? error.message : 'A data synchronization error occurred.');
        }
      }
    );

    const unsubInventory = onSnapshot(
      getInventoryRef(),
      async (snapshot) => {
        if (snapshot.exists()) {
          if (active) setInventory(snapshot.data() as InventoryState);
          return;
        }

        try {
          // Initialize once without overwriting an existing document.
          await runTransaction(db, async (transaction) => {
            const latest = await transaction.get(getInventoryRef());

            if (!latest.exists()) {
              transaction.set(
                getInventoryRef(),
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
        if (active) setDataError(error instanceof Error ? error.message : 'A data synchronization error occurred.');
      }
    );

    const unsubMenu = onSnapshot(
      getMenuRef(),
      async (snapshot) => {
        if (snapshot.exists()) {
          const savedMenu = snapshot.data() as MenuDefinition;

          if (active) {
            try {
              validateMenu(savedMenu);
              setMenu(savedMenu);
            } catch (error: unknown) {
              console.error('Invalid saved menu:', error);
              setDataError(error instanceof Error ? error.message : 'A data synchronization error occurred.');
            }
          }

          return;
        }

        try {
          await runTransaction(db, async (transaction) => {
            const latest = await transaction.get(getMenuRef());

            if (!latest.exists()) {
              transaction.set(getMenuRef(), DEFAULT_MENU);
            }
          });
        } catch (error: unknown) {
          console.error('Menu initialization error:', error);
        }
      },
      (error) => {
        console.error('Menu sync error:', error);
        if (active) setDataError(error instanceof Error ? error.message : 'A data synchronization error occurred.');
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
      <div className="flex min-h-screen items-center justify-center bg-[#faf8f5] px-4">
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
    <div className="min-h-screen bg-[#faf8f5] font-sans text-slate-800 antialiased selection:bg-orange-100">
      {dataError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
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
    <main className="min-h-screen bg-[#faf8f5] px-4 py-10 sm:px-8">
      <div className="mx-auto flex min-h-[80vh] max-w-5xl flex-col justify-center">
        <div className="mb-10 text-center sm:mb-14">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-white shadow-lg shadow-orange-200">
            <ChefHat size={34} />
          </div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-orange-600">Dimsum Hub · Point of Sale</p>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">Good food starts here.</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500 sm:text-base">Choose your station to manage orders, prepare fresh dimsum, and keep everything running smoothly.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RoleCard icon={<Receipt size={26} />} title="Cashier" desc="Create orders and manage checkout." color="bg-emerald-50 text-emerald-700" onClick={() => setRole('cashier')} />
          <RoleCard icon={<ChefHat size={26} />} title="Cooker" desc="Manage cooking batches and ready stock." color="bg-orange-50 text-orange-700" onClick={() => setRole('cooker')} />
          <RoleCard icon={<Utensils size={26} />} title="Server" desc="Review orders and serve customers." color="bg-blue-50 text-blue-700" onClick={() => setRole('server')} />
          <RoleCard icon={<Settings size={26} />} title="Manager" desc="Update menu items, combos, and prices." color="bg-violet-50 text-violet-700" onClick={() => setRole('manager')} />
          <RoleCard icon={<History size={26} />} title="History" desc="Review completed and cancelled orders." color="bg-slate-100 text-slate-700" onClick={() => setRole('history')} />
        </div>
        <p className="mt-10 text-center text-xs text-slate-400">Made with care, served fresh.</p>
      </div>
    </main>
  );
}

function RoleCard({ icon, title, desc, color, onClick }: RoleCardProps) {
  return (
    <button type="button" onClick={onClick}
      className="group flex min-h-40 items-start gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-orange-200 hover:shadow-xl hover:shadow-orange-950/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200 active:scale-[0.99] sm:p-6">
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${color} transition-transform group-hover:scale-105`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        <p className="mt-1.5 text-sm leading-5 text-slate-500">{desc}</p>
        <div className="mt-4 text-xs font-bold text-orange-600 transition-colors group-hover:text-orange-700">Open station <span aria-hidden="true">→</span></div>
      </div>
    </button>
  );
}

// ============================================================
// Shared header
// ============================================================

function Header({ title, setRole }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
      <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <button type="button" onClick={() => setRole(null)} aria-label="Back to station selection"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-100 active:scale-95">
          <ArrowLeft size={20} />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3 sm:justify-start">
          <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 sm:flex"><ChefHat size={20} /></div>
          <div className="min-w-0"><p className="truncate text-base font-extrabold tracking-tight text-slate-900 sm:text-lg">{title}</p><p className="hidden text-xs text-slate-500 sm:block">Dimsum Hub · Operations</p></div>
        </div>
        <div className="w-10 shrink-0" aria-hidden="true" />
      </div>
    </header>
  );
}

// ============================================================
// Cashier
// ============================================================

function CashierView({ setRole, menu }: CashierViewProps) {
  const [currentOrder, setCurrentOrder] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');

  const updateQty = (id: string, delta: number): void => {
    setCurrentOrder((prev) => {
      const newQty = (prev[id] || 0) + delta;

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
      return total + (Number(item?.price) || 0) * qty;
    },
    0
  );

  const submitOrder = async () => {
    if (totalItems === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      validateMenu(menu);

      const items = { ...currentOrder };

      for (const [id, qty] of Object.entries(items)) {
        const item = getMenuItem(menu, id);

        if (!item || !Number.isInteger(qty) || qty <= 0) {
          throw new Error('Please check the selected menu items.');
        }

        if (!Number.isFinite(Number(item.price)) || item.price < 0) {
          throw new Error(`Invalid price for ${item.name}.`);
        }
      }

      const itemDetails = Object.fromEntries(
        Object.entries(items).map(([id, qty]) => {
          const item = getMenuItem(menu, id);

          if (!item) {
            return [
              id,
              {
                name: id,
                price: 0,
                quantity: Number(qty),
              },
            ];
          }

          return [
            id,
            {
              name: item.name,
              price: Number(item.price),
              quantity: Number(qty),
            },
          ];
        })
      );

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
      setError(error instanceof Error ? error.message : 'Failed to submit order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5] pb-32">
      <Header title="Cashier Terminal" setRole={setRole} />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-5 sm:px-6 sm:py-7">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6">
          <label className="block text-sm font-bold text-slate-500 uppercase tracking-wider mb-2">
            Customer Name
          </label>

          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Enter customer name"
            maxLength={100}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
          />
        </section>

        <section>
          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">
            Combos
          </h2>

          <div className="space-y-3">
            {Object.values(menu.combos || {}).map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                qty={currentOrder[item.id] || 0}
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
            {Object.values(menu.base || {}).map((item) => (
              <MenuItemCard
                key={item.id}
                item={item}
                qty={currentOrder[item.id] || 0}
                onUpdate={(delta) => updateQty(item.id, delta)}
              />
            ))}
          </div>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-8px_30px_rgba(15,23,42,0.07)] backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="text-slate-600 font-medium flex flex-col">
            <span>
              Items:{' '}
              <span className="text-orange-600 font-bold text-xl">
                {totalItems}
              </span>
            </span>

            <span className="text-sm">
              Total:{' '}
              <span className="text-orange-600 font-bold">
                {formatCurrency(totalPrice)}
              </span>
            </span>
          </div>

          <button
            onClick={submitOrder}
            disabled={totalItems === 0 || isSubmitting}
            className="shrink-0 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white shadow-sm shadow-orange-200 transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {isSubmitting ? 'Sending...' : 'Send Order'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuItemCard({ item, qty, onUpdate }: MenuItemCardProps) {
  const unavailable = item.available === false;
  return (
    <article className={`flex items-center justify-between gap-3 rounded-2xl border bg-white p-4 transition-colors sm:p-5 ${qty > 0 ? 'border-orange-300 ring-2 ring-orange-50' : 'border-slate-200 hover:border-slate-300'} ${unavailable ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold leading-5 text-slate-900">{item.name}</h3>
        <p className="mt-2 text-base font-extrabold tabular-nums text-orange-600">{formatCurrency(item.price)}</p>
        {item.desc && <p className="mt-1 text-xs leading-5 text-slate-500">{item.desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 rounded-xl bg-slate-50 p-1">
        <button type="button" onClick={() => onUpdate(-1)} disabled={qty === 0 || unavailable} aria-label={`Decrease ${item.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-orange-200 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-40"><Minus size={17} /></button>
        <span aria-live="polite" className="w-7 text-center text-base font-extrabold tabular-nums text-slate-900">{qty}</span>
        <button type="button" onClick={() => onUpdate(1)} disabled={unavailable} aria-label={`Increase ${item.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={18} /></button>
      </div>
    </article>
  );
}

// ============================================================
// Cooker
// ============================================================

function CookerView({ setRole, orders, inventory, menu }: CookerViewProps) {
  const [cookInputs, setCookInputs] = useState<Record<string, number>>({});
  const [busyItems, setBusyItems] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  const neededStats = useMemo(() => {
    const stats = Object.fromEntries(
      Object.keys(menu.base || {}).map((id) => [id, 0])
    );

    orders
      .filter((order) => order.status === 'pending')
      .forEach((order) => {
        Object.entries(order.items || {}).forEach(([itemId, qty]) => {
          if (menu.base[itemId]) {
            stats[itemId] = (stats[itemId] || 0) + qty;
          } else if (menu.combos[itemId]) {
            Object.entries(
              menu.combos[itemId].contains || {}
            ).forEach(([baseId, baseQty]) => {
              stats[baseId] = (stats[baseId] || 0) + (baseQty * qty);
            });
          }
        });
      });

    return stats;
  }, [orders, menu]);

  const handleInput = (itemId: string, delta: number): void => {
    setCookInputs((prev) => ({
      ...prev,
      [itemId]: Math.max(1, (prev[itemId] || 1) + delta),
    }));
  };

  const updateInventoryItem = async (itemId: string, updater: (itemData: InventoryEntry) => InventoryEntry): Promise<void> => {
    if (busyItems[itemId]) return;

    setBusyItems((prev) => ({ ...prev, [itemId]: true }));
    setError('');

    try {
      await runTransaction(requireDb(), async (transaction) => {
        const inventoryRef = getInventoryRef();
        const snapshot = await transaction.get(inventoryRef);

        if (!snapshot.exists()) {
          throw new Error('Inventory has not been initialized.');
        }

        const currentInventory = snapshot.data() as InventoryState;
        const currentItem = currentInventory[itemId] || {
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
      setError(error instanceof Error ? error.message : 'Failed to update inventory.');
      throw error;
    } finally {
      setBusyItems((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const startBatch = async (itemId: string): Promise<void> => {
    const qty = cookInputs[itemId] || 1;

    if (!Number.isInteger(qty) || qty < 1) {
      setError('Batch quantity must be a positive integer.');
      return;
    }

    try {
      await updateInventoryItem(itemId, (itemData) => ({
        ...itemData,
        batches: [
          ...(itemData.batches || []),
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            qty,
            timestamp: Date.now(),
          },
        ],
      }));

      setCookInputs((prev) => ({ ...prev, [itemId]: 1 }));
    } catch {
      // Error is shown in the UI.
    }
  };

  const markBatchReady = async (itemId: string, batchId: string, qty: number): Promise<void> => {
    try {
      await updateInventoryItem(itemId, (itemData) => {
        const batches = itemData.batches || [];
        const batch = batches.find((entry) => entry.id === batchId);

        if (!batch) {
          throw new Error('This batch has already been processed.');
        }

        if (batch.qty !== qty) {
          throw new Error('Batch quantity has changed. Please refresh.');
        }

        return {
          ...itemData,
          batches: batches.filter((entry) => entry.id !== batchId),
          ready: (itemData.ready || 0) + qty,
        };
      });
    } catch {
      // Error is shown in the UI.
    }
  };

  const adjustReadyManual = async (itemId: string, delta: number): Promise<void> => {
    try {
      await updateInventoryItem(itemId, (itemData) => {
        const ready = itemData.ready || 0;
        const nextReady = ready + delta;

        if (nextReady < 0) {
          throw new Error('Ready stock cannot be negative.');
        }

        return {
          ...itemData,
          ready: nextReady,
        };
      });
    } catch {
      // Error is shown in the UI.
    }
  };

  const itemHeaderColors: Record<string, string> = {
    chickenCheeseRoll: 'bg-[#fcf7cd] text-[#714316]',
    chickenDumpling: 'bg-[#fdeed6] text-[#863813]',
    cheeseDimsum: 'bg-[#fef0c7] text-[#7a4100]',
    soup: 'bg-[#fee2e2] text-[#991b1b]',
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5]">
      <Header title="Kitchen Station" setRole={setRole} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 md:px-6 md:py-7">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-6">
          {Object.values(menu.base || {}).map((item) => {
            const needed = neededStats[item.id] || 0;
            const itemData = inventory[item.id] || {
              ready: 0,
              batches: [],
            };

            const ready = itemData.ready || 0;
            const batches = itemData.batches || [];

            const cookingTotal = batches.reduce(
              (sum, batch) => sum + batch.qty,
              0
            );

            const isDeficit = needed > cookingTotal + ready;
            const inputValue = cookInputs[item.id] || 1;
            const isBusy = Boolean(busyItems[item.id]);

            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm transition hover:shadow-md"
              >
                <div
                  className={`p-5 md:p-6 ${itemHeaderColors[item.id] ||
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
                      className={`text-3xl md:text-4xl font-black ${isDeficit
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
                    <div className="flex flex-col justify-between rounded-2xl border border-amber-100 bg-amber-50/80 p-5 sm:p-6">
                      <span className="text-[#965e23] font-bold uppercase text-[13px] mb-4 tracking-wider text-center">
                        Setup New Batch
                      </span>

                      <div className="flex items-center justify-center gap-4 mb-6">
                        <TabletButton
                          onClick={() => handleInput(item.id, -1)}
                          icon={<Minus size={32} />}
                          disabled={inputValue <= 1 || isBusy}
                        />

                        <span className="text-5xl font-black text-[#6b4216] w-20 text-center">
                          {inputValue}
                        </span>

                        <TabletButton
                          onClick={() => handleInput(item.id, 1)}
                          icon={<Plus size={32} />}
                          disabled={isBusy}
                        />
                      </div>

                      <button
                        onClick={() => startBatch(item.id)}
                        disabled={isBusy}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-4 text-lg font-bold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:opacity-50"
                      >
                        <Play size={20} fill="currentColor" />
                        {isBusy ? 'Processing...' : 'Steam / Fry Now'}
                      </button>
                    </div>

                    <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50/80 p-5 sm:p-6">
                      <span className="text-[#0d6e42] font-bold uppercase text-[13px] mb-4 tracking-wider">
                        Total Ready
                      </span>

                      <span className="text-6xl font-black text-[#0f5132] mb-6">
                        {ready}
                      </span>

                      <div className="flex gap-3">
                        <button
                          onClick={() => adjustReadyManual(item.id, -1)}
                          disabled={isBusy || ready <= 0}
                          className="px-3 py-2 bg-white rounded-lg text-slate-600 shadow-sm border disabled:opacity-40 flex items-center gap-1"
                        >
                          <Minus size={16} />
                          Adjust
                        </button>

                        <button
                          onClick={() => adjustReadyManual(item.id, 1)}
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
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 md:p-6">
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
                                markBatchReady(
                                  item.id,
                                  batch.id,
                                  batch.qty
                                )
                              }
                              disabled={isBusy}
                              className="rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100 disabled:opacity-50 flex items-center gap-1"
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

function TabletButton({ onClick, icon, disabled = false }: TabletButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600 active:scale-95 disabled:opacity-40 sm:h-[72px] sm:w-[72px]"
    >
      {icon}
    </button>
  );
}

// ============================================================
// Server
// ============================================================

function ServerView({ setRole, orders, inventory, menu }: ServerViewProps) {
  const [processingOrders, setProcessingOrders] = useState<Record<string, boolean>>({});
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
          throw new Error('Inventory has not been initialized.');
        }

        const latestOrder = orderSnapshot.data();

        if (latestOrder.status !== 'pending') {
          throw new Error('This order has already been processed.');
        }

        const latestInventory = inventorySnapshot.data() as InventoryState;
        const requiredBaseItems: Record<string, number> = {};

        Object.entries(
          (latestOrder.items || {}) as Record<string, number>
        ).forEach(([itemId, qty]) => {
          if (!Number.isInteger(qty) || qty <= 0) {
            throw new Error(`Invalid quantity for ${itemId}.`);
          }

          if (menu.base[itemId]) {
            requiredBaseItems[itemId] =
              (requiredBaseItems[itemId] || 0) + qty;
            return;
          }

          if (menu.combos[itemId]) {
            Object.entries(
              menu.combos[itemId].contains || {}
            ).forEach(([baseId, baseQty]) => {
              if (
                !menu.base[baseId] ||
                !Number.isInteger(baseQty) ||
                baseQty <= 0
              ) {
                throw new Error(
                  `Invalid combo item: ${baseId}.`
                );
              }

              requiredBaseItems[baseId] =
                (requiredBaseItems[baseId] || 0) + (baseQty * qty);
            });

            return;
          }

          throw new Error(`Unknown menu item: ${itemId}.`);
        }
        );

        const updatedInventory = { ...latestInventory };

        // Validate every item before committing any writes.
        for (const [baseId, neededQty] of Object.entries(
          requiredBaseItems
        )) {
          const itemData = latestInventory[baseId];

          if (!itemData) {
            throw new Error(
              `Inventory for ${menu.base[baseId].name} is missing.`
            );
          }

          const ready = itemData.ready || 0;

          if (ready < neededQty) {
            throw new Error(
              `Not enough ${menu.base[baseId].name}. ` +
              `Required: ${neededQty}, available: ${ready}.`
            );
          }

          updatedInventory[baseId] = {
            ...itemData,
            ready: ready - neededQty,
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
      setError(error instanceof Error ? error.message : 'Failed to serve order.');
    } finally {
      setProcessingOrders((prev) => ({
        ...prev,
        [order.id]: false,
      }));
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5]">
      <Header title="Server Station" setRole={setRole} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 sm:px-6 sm:py-7">
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
                onServe={() => serveOrder(order)}
                processing={Boolean(processingOrders[order.id])}
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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const timeWaiting = Math.max(
    0,
    Math.floor((now - (order.timestamp || now)) / 60000)
  );

  const orderNumber = order.id.slice(-4).toUpperCase();

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6">
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
          className="shrink-0 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:opacity-50"
        >
          {processing ? 'Serving...' : 'Serve'}
        </button>
      </div>

      <div className="space-y-2">
        {Object.entries(order.items || {}).map(([itemId, qty]) => (
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
  const [localMenu, setLocalMenu] = useState<MenuDefinition>(menu);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');

  useEffect(() => {
    setLocalMenu(menu);
  }, [menu]);

  const updateBaseItem = (
    id: string,
    field: keyof MenuItemBase,
    value: string | number | boolean | undefined
  ): void => {
    setLocalMenu((prev) => ({
      ...prev,
      base: {
        ...prev.base,
        [id]: {
          ...prev.base[id],
          [field]: value,
        } as MenuItemBase,
      },
    }));
  };

  const updateComboItem = (
    id: string,
    field: keyof MenuComboItem,
    value: string | number | boolean | Record<string, number> | undefined
  ): void => {
    setLocalMenu((prev) => ({
      ...prev,
      combos: {
        ...prev.combos,
        [id]: {
          ...prev.combos[id],
          [field]: value,
        } as MenuComboItem,
      },
    }));
  };

  const handleSave = async () => {
    if (saving) return;

    setSaving(true);
    setMessage('');

    try {
      validateMenu(localMenu);

      const normalizedMenu: MenuDefinition = {
        base: Object.fromEntries(
          Object.entries(localMenu.base as Record<string, MenuItemBase>).map(([id, item]) => [
            id,
            {
              ...item,
              name: item.name.trim(),
              price: Number(item.price),
            },
          ])
        ),
        combos: Object.fromEntries(
          Object.entries(localMenu.combos as Record<string, MenuComboItem>).map(([id, item]) => [
            id,
            {
              ...item,
              name: item.name.trim(),
              desc: item.desc || '',
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
      setMessage(error instanceof Error ? error.message : 'Failed to save menu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5] pb-32">
      <Header title="Menu Management" setRole={setRole} />

      <main className="mx-auto mt-3 w-full max-w-3xl flex-1 space-y-8 px-4 py-5 pb-8 sm:px-6">
        {message && (
          <div
            className={`p-4 rounded-xl text-center font-bold ${messageType === 'success'
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

          {Object.values(localMenu.base || {}).map((item) => (
            <div
              key={item.id}
              className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
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
                    onChange={(e) =>
                      updateBaseItem(
                        item.id,
                        'name',
                        e.target.value
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
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
                    onChange={(e) =>
                      updateBaseItem(
                        item.id,
                        'price',
                        e.target.value === ''
                          ? 0
                          : Number(e.target.value)
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
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

          {Object.values(localMenu.combos || {}).map((combo) => (
            <div
              key={combo.id}
              className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
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
                    onChange={(e) =>
                      updateComboItem(
                        combo.id,
                        'name',
                        e.target.value
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
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
                    onChange={(e) =>
                      updateComboItem(
                        combo.id,
                        'price',
                        e.target.value === ''
                          ? 0
                          : Number(e.target.value)
                      )
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase">
                  Description / Details
                </label>

                <input
                  type="text"
                  value={combo.desc || ''}
                  maxLength={250}
                  onChange={(e) =>
                    updateComboItem(
                      combo.id,
                      'desc',
                      e.target.value
                    )
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-4 focus:ring-orange-100"
                />
              </div>

              <div className="text-sm text-slate-500">
                Contains:{' '}
                {Object.entries(combo.contains || {})
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

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-8px_30px_rgba(15,23,42,0.07)] backdrop-blur-md">
        <div className="mx-auto max-w-3xl">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 py-4 font-bold text-white shadow-sm shadow-orange-200 transition hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
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

function HistoryView({ setRole, orders, menu }: HistoryViewProps) {
  const pastOrders = orders.filter(
    (order) => order.status !== 'pending'
  );

  const getHistoricalItemName = (order: Order, itemId: string): string =>
    order.itemDetails?.[itemId]?.name ||
    getMenuItemName(menu, itemId);

  const getHistoricalPrice = (order: Order, itemId: string): number => {
    const details = order.itemDetails?.[itemId];

    if (details && Number.isFinite(Number(details.price))) {
      return Number(details.price);
    }

    return Number(getMenuItem(menu, itemId)?.price) || 0;
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#faf8f5]">
      <Header title="Order History" setRole={setRole} />

      <main className="mx-auto mt-3 w-full max-w-3xl flex-1 space-y-4 px-4 py-5 sm:px-6">
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
                className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
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
                        ? new Date(order.timestamp).toLocaleString(
                          'id-ID'
                        )
                        : 'Unknown date'}
                    </div>

                    {order.servedAt && (
                      <div className="text-xs text-slate-500 mt-1">
                        Served:{' '}
                        {new Date(order.servedAt).toLocaleString(
                          'id-ID'
                        )}
                      </div>
                    )}
                  </div>

                  <div className="text-right flex flex-col items-end shrink-0">
                    <span
                      className={`inline-block px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full mb-2 ${order.status === 'served'
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
                  {Object.entries(order.items || {}).map(
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