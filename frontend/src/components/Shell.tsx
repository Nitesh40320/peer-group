import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, Bell, BookOpen, CalendarDays, ClipboardCheck, ClipboardList, FolderKanban, GraduationCap, HeartHandshake, LayoutDashboard, LifeBuoy, LogOut, Menu, MessagesSquare, Search, Settings as SettingsIcon, Shield, ShieldCheck, Sparkles, User as UserIcon, UserPlus, Users, Wrench, type LucideIcon } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useRealtime, type User } from '../lib/auth';
import { Avatar, Brand, Skeleton } from './ui';

type Item = [string, string, LucideIcon];

function navFor(user: User): Array<{ heading?: string; items: Item[] }> {
  if (user.role === 'admin') {
    return [{ items: [['/admin', 'Overview', LayoutDashboard], ['/admin/users', 'Users', Users], ['/admin/verifications', 'Teacher verification', ShieldCheck], ['/admin/reports', 'Reports', Shield], ['/admin/support', 'Support requests', LifeBuoy], ['/admin/audit', 'Audit log', ClipboardList], ['/admin/system', 'System', Wrench]] }];
  }
  if (user.role === 'teacher' && user.teacherStatus !== 'approved') {
    return [{ items: [['/app', 'Dashboard', LayoutDashboard], ['/app/verification', 'Verification', ShieldCheck], ['/app/profile', 'Profile', UserIcon]] }];
  }
  if (user.role === 'teacher') {
    return [
      { items: [['/app', 'Dashboard', LayoutDashboard], ['/app/analytics', 'Analytics', BarChart3]] },
      { heading: 'Teaching', items: [['/app/groups', 'Communities and groups', Users], ['/app/mentorship', 'Mentorship', HeartHandshake], ['/app/assignments', 'Assignments', ClipboardCheck], ['/app/sessions', 'Sessions', CalendarDays]] },
      { heading: 'Collaborate', items: [['/app/projects', 'Projects', FolderKanban], ['/app/messages', 'Messages', MessagesSquare], ['/app/resources', 'Resources', BookOpen], ['/app/discover', 'Students', Search], ['/app/connections', 'Connections', UserPlus]] },
      { items: [['/app/verification', 'Verification', ShieldCheck]] },
    ];
  }
  return [
    { items: [['/app', 'Dashboard', LayoutDashboard], ['/app/progress', 'Progress', Award]] },
    { heading: 'Connect', items: [['/app/discover', 'Discover', Search], ['/app/connections', 'Connections', UserPlus], ['/app/mentorship', 'Mentorship', GraduationCap]] },
    { heading: 'Collaborate', items: [['/app/groups', 'Study groups', Users], ['/app/projects', 'Projects', FolderKanban], ['/app/messages', 'Messages', MessagesSquare], ['/app/sessions', 'Sessions', CalendarDays]] },
    { heading: 'Learn', items: [['/app/resources', 'Resources', BookOpen], ['/app/assignments', 'Assignments', ClipboardCheck], ['/app/assistant', 'AI assistant', Sparkles]] },
  ];
}

export function Shell() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const base = user?.role === 'admin' ? '/admin' : '/app';
  useRealtime(!!user);

  const unread = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get('/notifications/unread-count'), enabled: !!user, refetchInterval: 60000 });
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get('/meta'), staleTime: 300000 });

  useEffect(() => { setOpen(false); setMenu(false); }, [location.pathname]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); setOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);

  if (!user) return null;
  const count = unread.data?.count ?? 0;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand"><Brand to={base} /></div>
        <nav aria-label="Main">
          {navFor(user).map((group, i) => (
            <div key={i}>
              {group.heading && <div className="nav-group">{group.heading}</div>}
              {group.items.map(([to, label, Icon]) => (
                <NavLink key={to} to={to} end={to === '/app' || to === '/admin'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon size={18} aria-hidden="true" />{label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="main-area">
        {meta.data?.announcement_banner && <div className="banner">{meta.data.announcement_banner}</div>}
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu size={22} aria-hidden="true" /></button>
          <div className="grow" />
          <Link className="icon-btn" to={`${base}/notifications`} aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
            <Bell size={20} aria-hidden="true" />{count > 0 && <span className="dot" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
          </Link>
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button className="icon-btn" aria-label="Account menu" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu((m) => !m)}><Avatar name={user.fullName} fileId={user.avatarFileId} size={32} /></button>
            {menu && (
              <div className="menu">
                <div style={{ padding: '.5rem .625rem' }}>
                  <div className="break" style={{ fontWeight: 600 }}>{user.fullName}</div>
                  <div className="small muted break">{user.email}</div>
                </div>
                {user.role !== 'admin' && <Link to="/app/profile"><UserIcon size={16} aria-hidden="true" />Profile</Link>}
                <Link to={`${base}/settings`}><SettingsIcon size={16} aria-hidden="true" />Settings</Link>
                <Link to="/help"><LifeBuoy size={16} aria-hidden="true" />Help and support</Link>
                <button onClick={async () => { await logout(); navigate('/', { replace: true }); }}><LogOut size={16} aria-hidden="true" />Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="main" tabIndex={-1}>
          <Suspense fallback={<Skeleton lines={6} />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
