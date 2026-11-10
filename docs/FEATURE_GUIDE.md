# Feature guide and status

**Complete** means implemented and exercised by the automated tests or a browser workflow. **Partial** and **Needs setup** are explained.

| Feature | Status | Notes |
|---|---|---|
| Registration, verification, sign-in, logout, reset | Complete | Delivery through a real mail server is **Needs setup** |
| Roles and backend authorization | Complete | |
| Student and teacher profiles, privacy | Complete | |
| Discovery, connections, block, report | Complete | |
| Partner matching with explanations | Complete | Weighted rules, not machine learning |
| Study groups and membership | Complete | |
| Group workspace | Complete | One shared implementation |
| Projects, board, milestones, documents, discussion | Complete | |
| Messaging | Complete | Real-time on a single server instance; see `ARCHITECTURE.md` |
| Study sessions, reminders, attendance | Complete | Attendance is self check-in during the session window |
| Learning resources | Complete | Local disk storage |
| Mentorship | Complete | |
| Teacher verification | Complete | |
| Assignments and review | Complete | Students joining a group later do not receive earlier assignments |
| Teacher analytics | Complete | Engagement indicators, not grades |
| Student progress | Complete | |
| Notifications and preferences | Complete | |
| Administration, moderation, audit log | Complete | |
| Help and support | Complete | Requests are read in the admin area; replies go by email outside the app |
| Role and permission management | Partial | Administrators see a read-only matrix. Roles are fixed in server code; custom roles are not implemented |
| AI assistant | Needs setup | Needs `ANTHROPIC_API_KEY`. Only the unavailable path has been tested; a live AI call has not |
| Email delivery | Needs setup | Needs SMTP. Code path uses nodemailer; not tested against a real mail server |
| Cloud file storage | Partial | `FileStorage` interface exists; only local disk is implemented |
| Calendar integration | Partial | Downloadable `.ics` files work; no two-way sync with Google or Outlook |
| Error monitoring | Partial | Structured logs and an optional webhook; no vendor SDK |
| Terms and privacy text | Needs review | Written to match behaviour, not reviewed by a lawyer |

## Using PeerConnect

**Students:** complete your profile, use Discover to connect, create or join a study group, then work in its workspace. Start projects from a group's Projects tab.

**Teachers:** register, verify your email, then wait for approval on the Verification page. Afterwards you can create academic communities, accept mentorship requests and set assignments.

**Administrators:** review teachers under Teacher verification, moderate under Reports, and manage settings under System.

## Removed from the old site

Advantages, Features, Contact, Testimonials and the duplicate sign-in pages are gone from the application. Useful copy moved to the landing page, Contact became Help and Support, and old URLs redirect. The testimonials were not carried over because they could not be confirmed as genuine. The "Premium" tier described on the old site was not built, as it was never part of this brief and no billing exists.
