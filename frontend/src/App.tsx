import { Component, lazy, Suspense, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Skeleton } from './components/ui';
import { homeFor, useAuth, type User } from './lib/auth';

const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

const publicPages = () => import('./pages/Public');
const authPages = () => import('./pages/Auth');
const peoplePages = () => import('./pages/People');
const groupPages = () => import('./pages/Groups');
const workPages = () => import('./pages/Work');
const guidancePages = () => import('./pages/Guidance');
const adminPages = () => import('./pages/Admin');

// Lazy so signed-in users do not download the landing page's animation library.
const Landing = page(() => import('./pages/Landing'), 'Landing');
const Help = page(publicPages, 'Help');
const Terms = page(publicPages, 'Terms');
const Privacy = page(publicPages, 'Privacy');
const Login = page(authPages, 'Login');
const Register = page(authPages, 'Register');
const ForgotPassword = page(authPages, 'ForgotPassword');
const ResetPassword = page(authPages, 'ResetPassword');
const VerifyEmail = page(authPages, 'VerifyEmail');
const Dashboard = page(peoplePages, 'Dashboard');
const Profile = page(peoplePages, 'Profile');
const Settings = page(peoplePages, 'Settings');
const Discover = page(peoplePages, 'Discover');
const Connections = page(peoplePages, 'Connections');
const UserView = page(peoplePages, 'UserView');
const Progress = page(peoplePages, 'ProgressPage');
const Notifications = page(peoplePages, 'Notifications');
const GroupsPage = page(groupPages, 'GroupsPage');
const Workspace = page(groupPages, 'Workspace');
const Projects = page(workPages, 'Projects');
const ProjectDetail = page(workPages, 'ProjectDetail');
const Messages = page(workPages, 'Messages');
const Sessions = page(workPages, 'Sessions');
const Resources = page(workPages, 'Resources');
const Assistant = page(workPages, 'Assistant');
const Mentorship = page(guidancePages, 'Mentorship');
const Assignments = page(guidancePages, 'Assignments');
const AssignmentDetail = page(guidancePages, 'AssignmentDetail');
const Verification = page(guidancePages, 'Verification');
const Analytics = page(guidancePages, 'Analytics');
const AdminDashboard = page(adminPages, 'AdminDashboard');
const AdminUsers = page(adminPages, 'AdminUsers');
const AdminVerifications = page(adminPages, 'AdminVerifications');
const AdminReports = page(adminPages, 'AdminReports');
const AdminSupport = page(adminPages, 'AdminSupport');
const AdminAudit = page(adminPages, 'AdminAudit');
const AdminSystem = page(adminPages, 'AdminSystem');

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" role="alert" style={{ minHeight: '60vh', alignContent: 'center' }}>
        <strong>Something went wrong displaying this page.</strong>
        <button className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
      </div>
    );
  }
}

const Loading = () => <div style={{ padding: '2rem' }}><Skeleton lines={5} /></div>;

function canAccess(user: User, need: 'student' | 'teacher' | 'approved_teacher' | 'collab') {
  if (need === 'student') return user.role === 'student';
  if (need === 'teacher') return user.role === 'teacher';
  if (need === 'approved_teacher') return user.role === 'teacher' && user.teacherStatus === 'approved';
  return user.role === 'student' || (user.role === 'teacher' && user.teacherStatus === 'approved');
}

/** Hides screens from the wrong role. The server enforces the same rules on every request. */
function Guard({ need, children }: { need: Parameters<typeof canAccess>[1]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  return canAccess(user, need) ? children : <Navigate to={homeFor(user)} replace />;
}

function Protected({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (admin !== (user.role === 'admin')) return <Navigate to={homeFor(user)} replace />;
  return <Shell />;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Navigate to={homeFor(user)} replace /> : children;
}

const NotFound = () => (
  <div className="empty" style={{ minHeight: '70vh', alignContent: 'center' }}>
    <strong>We could not find that page.</strong>
    <Link className="btn btn-primary" to="/">Go to PeerConnect</Link>
  </div>
);

export function App() {
  const collab = (el: ReactNode) => <Guard need="collab">{el}</Guard>;
  return (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/help" element={<Help />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route path="/app" element={<Protected />}>
            <Route index element={<Dashboard />} />
            <Route path="profile" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="users/:id" element={<UserView />} />
            <Route path="verification" element={<Guard need="teacher"><Verification /></Guard>} />
            <Route path="discover" element={collab(<Discover />)} />
            <Route path="connections" element={collab(<Connections />)} />
            <Route path="groups" element={collab(<GroupsPage />)} />
            <Route path="groups/:id" element={collab(<Workspace />)} />
            <Route path="projects" element={collab(<Projects />)} />
            <Route path="projects/:id" element={collab(<ProjectDetail />)} />
            <Route path="messages" element={collab(<Messages />)} />
            <Route path="messages/:id" element={collab(<Messages />)} />
            <Route path="sessions" element={collab(<Sessions />)} />
            <Route path="resources" element={collab(<Resources />)} />
            <Route path="assistant" element={collab(<Assistant />)} />
            <Route path="mentorship" element={collab(<Mentorship />)} />
            <Route path="assignments" element={collab(<Assignments />)} />
            <Route path="assignments/:id" element={collab(<AssignmentDetail />)} />
            <Route path="progress" element={<Guard need="student"><Progress /></Guard>} />
            <Route path="analytics" element={<Guard need="approved_teacher"><Analytics /></Guard>} />
          </Route>

          <Route path="/admin" element={<Protected admin />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="verifications" element={<AdminVerifications />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="support" element={<AdminSupport />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="system" element={<AdminSystem />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
