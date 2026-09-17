import {defineConfig} from 'vite';
// base './' (17 Sep 2026): the game is hosted on Genex, which serves the build under its own origin/path, so asset
// URLs in the build are relative instead of rooted at '/'.
export default defineConfig({base:'./',build:{rolldownOptions:{input:{game:'index.html',animations:'animation-review.html',idleVideo:'boss-idle-video.html',walkVideo:'boss-walk-video.html',motionVideos:'motion-videos.html'},output:{codeSplitting:{groups:[{name:'three',test:/node_modules\/three/}]}}}}});
