<script setup>
import homeScreen from '../../images/home-screen.png';
import editorPreview from '../../images/js-editor.png';
import mediaPreview from '../../images/image-preview-modal.png';

const ArrowIcon = `M5 12h14m-6-6 6 6-6 6`;
</script>

<template>
  <main class="landing">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-copy">
        <a class="eyebrow" href="/reference/releases">
          <span class="eyebrow-dot"></span>
          Self-hosted. Secure. Yours.
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg>
        </a>

        <h1 id="hero-title">Your files.<br /><span>Beautifully organized.</span></h1>
        <p class="hero-lede">
          A refined, self-hosted file explorer for teams and homelabs. Keep full control of your
          data without giving up a great experience.
        </p>

        <div class="hero-actions">
          <a class="landing-button button-primary" href="/quick-launch/overview">
            Get started
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg>
          </a>
          <a class="landing-button button-secondary" href="/experience/features"
            >Explore features</a
          >
        </div>

        <div class="hero-meta" aria-label="Product highlights">
          <span
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>One Docker
            container</span
          >
          <span
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>Open
            source</span
          >
          <span
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>No cloud
            required</span
          >
        </div>
      </div>

      <div class="product-stage" aria-label="nextExplorer application preview">
        <div class="product-window">
          <div class="window-bar">
            <div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div>
            <div class="window-address"><span></span>explorer.local</div>
            <div class="window-spacer"></div>
          </div>
          <img :src="homeScreen" alt="nextExplorer workspace showing mounted volumes" />
        </div>
        <div class="stage-pill stage-pill-security">
          <span class="stage-icon"
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 5 6v5c0 4.6 2.9 8.6 7 10 4.1-1.4 7-5.4 7-10V6l-7-3Z" />
              <path d="m9 12 2 2 4-4" /></svg
          ></span>
          <span><strong>Private by design</strong><small>Your server, your rules</small></span>
        </div>
        <div class="stage-pill stage-pill-fast">
          <span class="status-dot"></span>
          Ready in minutes
        </div>
      </div>
    </section>

    <section class="section feature-section" aria-labelledby="features-title">
      <div class="feature-intro">
        <p class="kicker">Made for real file systems</p>
        <h2 id="features-title">Leave your files where they are.<br />Make them better to use.</h2>
        <p>
          nextExplorer adds a thoughtful, modern layer to the storage you already trust—without
          asking you to migrate into someone else’s library.
        </p>
      </div>

      <article class="feature-row mount-feature">
        <div class="feature-copy">
          <span class="feature-number">01 / Volumes</span>
          <h3>Mount it.<br />It’s already organized.</h3>
          <p>
            Point nextExplorer at any host directory and it appears as a named volume. Your folders
            stay exactly where they are—same paths, same structure, zero importing or rearranging.
          </p>
          <div class="feature-tags">
            <span>Any directory</span><span>Multiple volumes</span><span>No migration</span>
          </div>
        </div>

        <div class="mount-visual" aria-label="Three host directories becoming nextExplorer volumes">
          <div class="mount-source">
            <div><span class="folder-mark"></span><code>/srv/projects</code></div>
            <div><span class="folder-mark"></span><code>/nas/photos</code></div>
            <div><span class="folder-mark"></span><code>/media/archive</code></div>
          </div>
          <div class="mount-flow" aria-hidden="true">
            <i></i
            ><span
              ><svg viewBox="0 0 24 24"><path :d="ArrowIcon" /></svg></span
            ><i></i>
          </div>
          <div class="mount-app">
            <div class="mini-app-title"><img src="/images/logo.png" alt="" /> nextExplorer</div>
            <small>VOLUMES</small>
            <div><span class="drive-mark"></span>Projects</div>
            <div><span class="drive-mark"></span>Photos</div>
            <div><span class="drive-mark"></span>Archive</div>
          </div>
        </div>
      </article>

      <article class="feature-row search-feature">
        <div
          class="search-visual"
          aria-label="Example of search matching file names and file contents"
        >
          <div class="search-bar-mock">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m16 16 4 4" />
            </svg>
            <span>quarterly revenue</span><kbd>⌘ K</kbd>
          </div>
          <div class="search-scope"><span>Everywhere</span><span>12 results</span></div>
          <div class="search-result">
            <span class="result-icon result-sheet">X</span>
            <span><strong>Q4-forecast.xlsx</strong><small>Finance / Forecasts</small></span>
            <em>Filename</em>
          </div>
          <div class="search-result active">
            <span class="result-icon result-doc">¶</span>
            <span
              ><strong>board-notes.pdf</strong
              ><small>“…reviewed the <mark>quarterly revenue</mark> outlook…”</small></span
            >
            <em>Content</em>
          </div>
          <div class="search-result">
            <span class="result-icon result-code">&lt;/&gt;</span>
            <span
              ><strong>metrics.ts</strong
              ><small>“…label: '<mark>quarterly revenue</mark>'…”</small></span
            >
            <em>Content</em>
          </div>
        </div>

        <div class="feature-copy">
          <span class="feature-number">02 / Search</span>
          <h3>Find the file.<br />Or the words inside it.</h3>
          <p>
            Search across filenames and file contents from one fast interface. nextExplorer can
            surface matching text inside code, documents, and PDFs—not just files whose names you
            happen to remember.
          </p>
          <a class="feature-link" href="/experience/workflows#search"
            >Explore global search
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></a>
        </div>
      </article>

      <div class="feature-pair">
        <article class="feature-card favorites-feature">
          <div class="feature-copy">
            <span class="feature-number">03 / Workspace</span>
            <h3>The familiar,<br />made delightful.</h3>
            <p>
              Move naturally between grid, list, and column views. Pin important folders as personal
              favorites, then give each one its own name, color, and icon.
            </p>
          </div>
          <div class="favorites-visual" aria-label="Customized favorite folders">
            <div>
              <span class="favorite-icon coral">◆</span
              ><span><strong>Client work</strong><small>/Projects/Active</small></span
              ><b>⌘1</b>
            </div>
            <div>
              <span class="favorite-icon violet">✦</span
              ><span><strong>Design library</strong><small>/Assets/Brand</small></span
              ><b>⌘2</b>
            </div>
            <div>
              <span class="favorite-icon green">♪</span
              ><span><strong>Music</strong><small>/Media/Audio</small></span
              ><b>⌘3</b>
            </div>
          </div>
        </article>

        <article class="feature-card terminal-feature">
          <div class="feature-copy">
            <span class="feature-number">04 / Terminal</span>
            <h3>When clicking<br />isn’t enough.</h3>
            <p>
              Admins can open a real terminal in the current directory without leaving the browser.
              Run a command, refresh the workspace, and keep moving.
            </p>
          </div>
          <div class="terminal-visual" aria-label="Integrated terminal example">
            <div class="terminal-title">
              <span><i></i><i></i><i></i></span><small>projects — zsh</small>
            </div>
            <code
              ><span>~</span> cd /mnt/Projects<br /><span>Projects</span> ls -la<br /><b
                >drwxr-xr-x</b
              >
              &nbsp;client-work<br /><b>drwxr-xr-x</b> &nbsp;design-system<br /><span
                >Projects</span
              >
              <i class="terminal-cursor"></i
            ></code>
          </div>
        </article>
      </div>

      <article class="feature-row media-feature">
        <div class="feature-copy">
          <span class="feature-number">05 / File previews</span>
          <h3>See what’s inside.<br />Open nothing else.</h3>
          <p>
            Inspect photos, RAW captures, video, audio, and PDFs directly in the browser. Move
            through a folder in the full-size viewer while every original file stays untouched.
          </p>
          <div class="format-row" aria-label="Example supported formats">
            <span>HEIC</span><span>NEF</span><span>ARW</span><span>DNG</span><span>CR2</span
            ><span>RAF</span>
          </div>
        </div>
        <div class="media-visual">
          <img :src="mediaPreview" alt="Image opened in nextExplorer's built-in media viewer" />
          <div class="media-caption">
            <span><i></i> Original file</span><span>Previewed in place</span>
          </div>
        </div>
      </article>

      <article class="feature-row editor-feature">
        <div class="editor-visual">
          <img :src="editorPreview" alt="JavaScript file open in nextExplorer's built-in editor" />
          <div class="editor-caption">
            <span><i></i> app.js</span><span>JavaScript · Saved</span>
          </div>
        </div>
        <div class="feature-copy">
          <span class="feature-number">06 / Editor</span>
          <h3>Make the change.<br />Stay in context.</h3>
          <p>
            Open and edit text, code, and configuration files without leaving nextExplorer. Syntax
            highlighting, themes, and familiar editor controls make quick changes feel natural.
          </p>
          <a class="feature-link" href="/experience/features#editing-sharing-document-workflows"
            >Explore editing options
            <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></a>
        </div>
      </article>

      <div class="feature-pair">
        <article class="feature-card permissions-feature">
          <div class="feature-copy">
            <span class="feature-number">07 / User permissions</span>
            <h3>The right access.<br />For every user.</h3>
            <p>
              Decide who can see, download, upload, edit, or delete files. Apply clear rules to each
              location without changing the permissions on disk.
            </p>
            <a class="feature-link" href="/admin/guide"
              >Manage user access
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
            ></a>
          </div>
          <div class="permissions-visual" aria-label="Permissions assigned to a user">
            <div class="permission-user">
              <span>AS</span>
              <span><strong>Alex Smith</strong><small>Projects / Client work</small></span>
              <em>Custom</em>
            </div>
            <div class="permission-list">
              <span><i class="permission-check">✓</i>View &amp; download</span>
              <span><i class="permission-check">✓</i>Upload &amp; edit</span>
              <span><i>—</i>Delete items</span>
            </div>
          </div>
        </article>

        <article class="feature-card sharing-feature">
          <div class="feature-copy">
            <span class="feature-number">08 / Sharing</span>
            <h3>Send a link.<br />Keep control.</h3>
            <p>
              Share a file or folder through a clean public page. Add a password and expiration so
              access lasts only as long as it should.
            </p>
            <a class="feature-link" href="/experience/workflows#sharing-items"
              >Learn about sharing
              <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
            ></a>
          </div>
          <div class="sharing-visual" aria-label="Protected share link options">
            <div class="share-file">
              <span class="folder-mark"></span><strong>Brand assets</strong>
            </div>
            <small>SHARE LINK</small>
            <div class="share-url"><span>explorer.local/s/brand…</span><b>Copy</b></div>
            <div class="share-options">
              <span><i>✓</i>Password protected</span><span><i>7</i>Expires in 7 days</span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="section docs-section" aria-labelledby="docs-title">
      <div class="section-heading">
        <div>
          <p class="kicker">Documentation</p>
          <h2 id="docs-title">Everything you need,<br />right where you expect it.</h2>
        </div>
        <p>
          From first launch to production hardening, follow concise guides written for real
          deployments.
        </p>
      </div>

      <div class="doc-grid">
        <a class="doc-card doc-card-featured" href="/quick-launch/overview">
          <span class="card-icon icon-amber"
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m14 4 6 6-8 8-6 1 1-6 7-9Z" />
              <path d="m13 5 6 6M5 19l-2 2" /></svg
          ></span>
          <span class="card-index">01</span>
          <span class="card-copy"
            ><small>Start here</small><strong>Quick launch</strong
            ><span
              >Go from Docker Compose to your first mounted volume in a few clear steps.</span
            ></span
          >
          <span class="card-arrow"
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></span>
        </a>

        <a class="doc-card" href="/installation/deployment">
          <span class="card-icon"
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16v12H4zM8 7V4h8v3M8 12h.01M12 12h.01" /></svg
          ></span>
          <span class="card-index">02</span>
          <span class="card-copy"
            ><small>Ship with confidence</small><strong>Deployment</strong
            ><span
              >Configure containers, persistent storage, backups, and production networking.</span
            ></span
          >
          <span class="card-arrow"
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></span>
        </a>

        <a class="doc-card" href="/configuration/environment">
          <span class="card-icon"
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" /></svg
          ></span>
          <span class="card-index">03</span>
          <span class="card-copy"
            ><small>Make it yours</small><strong>Configuration</strong
            ><span
              >Tune authentication, limits, previews, sessions, and every runtime option.</span
            ></span
          >
          <span class="card-arrow"
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></span>
        </a>

        <a class="doc-card" href="/integrations/oidc">
          <span class="card-icon"
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 12a4 4 0 1 1 4 4H6a3 3 0 1 1 .4-6M16 8h2a3 3 0 0 1 .6 5.9" /></svg
          ></span>
          <span class="card-index">04</span>
          <span class="card-copy"
            ><small>Connect your stack</small><strong>Integrations</strong
            ><span>Add OIDC, Authelia, ONLYOFFICE, or Collabora to your workspace.</span></span
          >
          <span class="card-arrow"
            ><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
          ></span>
        </a>
      </div>
    </section>

    <section class="section deploy-section" aria-labelledby="deploy-title">
      <div class="deploy-copy">
        <p class="kicker">Simple by default</p>
        <h2 id="deploy-title">One container.<br />Your entire workspace.</h2>
        <p>
          Mount your data, persist the configuration, and launch. nextExplorer handles previews,
          search, authentication, and sharing.
        </p>
        <a class="text-link" href="/installation/deployment"
          >Read the deployment guide
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
        ></a>
      </div>

      <div class="code-window" aria-label="Docker Compose configuration example">
        <div class="code-topline">
          <span>compose.yaml</span><span class="code-language"><i></i> YAML</span>
        </div>
        <pre><code><span class="code-muted">services:</span>
  <span class="code-key">nextexplorer:</span>
    image: <span class="code-value">nxzai/explorer:latest</span>
    ports:
      - <span class="code-value">'3000:3000'</span>
    volumes:
      - <span class="code-value">/srv/config:/config</span>
      - <span class="code-value">/srv/data:/mnt/data</span></code></pre>
        <div class="code-status">
          <span><i></i> Container healthy</span><span>localhost:3000 ↗</span>
        </div>
      </div>
    </section>

    <section class="closing">
      <img src="/images/logo.png" alt="" width="72" height="72" />
      <p class="kicker">Ready when you are</p>
      <h2>Make your files feel at home.</h2>
      <p>Launch a private, polished workspace in minutes.</p>
      <div class="hero-actions">
        <a class="landing-button button-primary" href="/quick-launch/overview"
          >Start building <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ArrowIcon" /></svg
        ></a>
        <a
          class="landing-button button-secondary"
          href="https://github.com/vikramsoni2/nextExplorer"
          target="_blank"
          rel="noreferrer"
          >View on GitHub</a
        >
      </div>
    </section>
  </main>
</template>
