# [1.8.0](https://github.com/ashwaryy/roundtable/compare/v1.7.0...v1.8.0) (2026-05-29)


### Features

* add immediate UI feedback after room is started and before agents report ready ([5d84eda](https://github.com/ashwaryy/roundtable/commit/5d84eda6e4dfb62ddb032bfc4e3ad01065e3ebc0))
* simplify UI and logic for when agents appear to be stuck and asking for user input ([2c8c513](https://github.com/ashwaryy/roundtable/commit/2c8c513784654a7fb23aa15ee4b29e569f38ee43))

# [1.7.0](https://github.com/ashwaryy/roundtable/compare/v1.6.0...v1.7.0) (2026-05-29)


### Features

* centralize runtime model and effort configuration ([09835e6](https://github.com/ashwaryy/roundtable/commit/09835e6ef5caaa34469313692493ea61b8973c57))
* configure agent-room command wrappers via env var ([5787fc7](https://github.com/ashwaryy/roundtable/commit/5787fc749e7d3fef8616b743747b56330d493456))

# [1.6.0](https://github.com/ashwaryy/roundtable/compare/v1.5.0...v1.6.0) (2026-05-28)


### Bug Fixes

* align saved output page header and skeleton with workspace layout ([b75daa7](https://github.com/ashwaryy/roundtable/commit/b75daa70e1892ef7b9152fc1a64528f9f72c4865))


### Features

* let stopped rooms resume or start fresh ([0f4f424](https://github.com/ashwaryy/roundtable/commit/0f4f42419572ae9064e190bdae00594579de9699))

# [1.5.0](https://github.com/ashwaryy/roundtable/compare/v1.4.1...v1.5.0) (2026-05-28)


### Bug Fixes

* avoid repeated integrity rehashes and cache room preflight probes ([ee99789](https://github.com/ashwaryy/roundtable/commit/ee99789974642c1a56bedbf33acf8f40ebf0a4af))
* bind backend to loopback by default and clarify exposure logging ([bbdf528](https://github.com/ashwaryy/roundtable/commit/bbdf52878dd452bb9dbf725f2bdd99e4e57e4025))
* debounce room detail tmux probes ([9e07fe2](https://github.com/ashwaryy/roundtable/commit/9e07fe29ed5fd9d19c40eb0a649d6c4e55c282f5))
* finish type-aware eslint cleanup and gate lint in ci ([1624643](https://github.com/ashwaryy/roundtable/commit/162464330015b2feb2e4f757f99dbe4d2a0239c3))
* raise JSON body limit and avoid duplicate thread summary reads ([8b0a2f5](https://github.com/ashwaryy/roundtable/commit/8b0a2f5d67e059be63ec66bbc22d531b8120bb9b))
* remove blocking room probes and preserve thread summary dirty state ([033343b](https://github.com/ashwaryy/roundtable/commit/033343b63bd7fc5b78966382852d355f15d69a3a))
* reuse a shared remark plugin array across markdown views ([59dc10e](https://github.com/ashwaryy/roundtable/commit/59dc10e36fccda35c618718110e2f969c2c563f4))


### Features

* cap attachment upload size and count ([4d72d9b](https://github.com/ashwaryy/roundtable/commit/4d72d9b2f39f250b883f04dfb1af00f94dedb501))
* show verified snapshot file counts during thread creation ([9c71898](https://github.com/ashwaryy/roundtable/commit/9c71898d74199e630e68a350013970d1a429cdd8))

## [1.4.1](https://github.com/ashwaryy/roundtable/compare/v1.4.0...v1.4.1) (2026-05-28)


### Bug Fixes

* require agents to verify snapshot and attachment context before commenting on file visibility ([aefdb8d](https://github.com/ashwaryy/roundtable/commit/aefdb8d29ec825d2ba5efa30012e6bb2ea1f3252))

# [1.4.0](https://github.com/ashwaryy/roundtable/compare/v1.3.4...v1.4.0) (2026-05-28)


### Bug Fixes

* reduce avoidable frontend rerenders ([32f1905](https://github.com/ashwaryy/roundtable/commit/32f1905e64d2db21b8dcbb702dd256b1fcfa8aee))
* reduce room polling and improve tmux viewer refresh ([42ffc02](https://github.com/ashwaryy/roundtable/commit/42ffc021b793d68aaf468ae8f9915d3021b467b7))
* reduce thread polling and speed up tmux viewer refresh ([0b7144f](https://github.com/ashwaryy/roundtable/commit/0b7144fdf19cff93af7e3e2ff23b47c7b6ca1222))
* simplify inline reply composer ([498ffc9](https://github.com/ashwaryy/roundtable/commit/498ffc9768167d607a35bacb25d32eb9dd4531d1))


### Features

* add tmux viewer input controls ([b8e154b](https://github.com/ashwaryy/roundtable/commit/b8e154b6ca4442238523416f087e1e42f8ced27f))
* improve frontend room controls, agent dialog labels, and topbar nav ([763e8cc](https://github.com/ashwaryy/roundtable/commit/763e8cc92ae6e40e28fddd1a5b15a06d60743cf5))
* show configured agent accents in comment bubbles ([9a7644d](https://github.com/ashwaryy/roundtable/commit/9a7644d2ace9a754bbbc259ed7e82345969ae091))

## [1.3.4](https://github.com/ashwaryy/roundtable/compare/v1.3.3...v1.3.4) (2026-05-27)


### Bug Fixes

* show room stop control during auto mode ([673ad1c](https://github.com/ashwaryy/roundtable/commit/673ad1c4bb1e9683228f35ffbad1020c07f77543))
* style recovery card with semantic warn/error tokens and status pill ([af014a2](https://github.com/ashwaryy/roundtable/commit/af014a22cfc1d44fa1dae1c5b6b94d47c9b97153))

## [1.3.3](https://github.com/ashwaryy/roundtable/compare/v1.3.2...v1.3.3) (2026-05-27)


### Bug Fixes

* pace tmux prompt submission ([fc511a0](https://github.com/ashwaryy/roundtable/commit/fc511a06437b8609f5f5951817537bd8513854a2))

## [1.3.2](https://github.com/ashwaryy/roundtable/compare/v1.3.1...v1.3.2) (2026-05-27)


### Bug Fixes

* submit room prompts with carriage return ([2d9dc9a](https://github.com/ashwaryy/roundtable/commit/2d9dc9a130a865cbe0f1e4ad49fee403bda9c0e3))
* write idle room prompts to markdown files ([334c330](https://github.com/ashwaryy/roundtable/commit/334c33076da4a4769c7c363454b30ef6d99bb537))

## [1.3.1](https://github.com/ashwaryy/roundtable/compare/v1.3.0...v1.3.1) (2026-05-27)


### Bug Fixes

* emit snapshot worker at runtime path ([126293b](https://github.com/ashwaryy/roundtable/commit/126293bb11949f17e4c8c51f65c25c17d810628d))

# [1.3.0](https://github.com/ashwaryy/roundtable/compare/v1.2.0...v1.3.0) (2026-05-26)


### Features

* add logo and tagline to thread list header ([259b57a](https://github.com/ashwaryy/roundtable/commit/259b57ac420e8ab1a2f734e7b1e28bd0bf026646))

# [1.2.0](https://github.com/ashwaryy/roundtable/compare/v1.1.0...v1.2.0) (2026-05-26)


### Bug Fixes

* cache room summaries for thread list reads ([be6ab08](https://github.com/ashwaryy/roundtable/commit/be6ab0869f8f61cd292a9108f41823980b54aaac))
* close backend performance pass correctness gaps ([0c0e05b](https://github.com/ashwaryy/roundtable/commit/0c0e05b601bed4123396529f26d48f71c1f3454e))
* close backend performance pass edge cases ([9ee6ca1](https://github.com/ashwaryy/roundtable/commit/9ee6ca1c1409561bbc58c32b90e9faccf9761858))
* comment side rail styling ([3bcdbe5](https://github.com/ashwaryy/roundtable/commit/3bcdbe5ebfb50d545321b0b7a45a8266a597c3f9))
* denormalize thread summaries and migrate backend ids to counters ([3c0c285](https://github.com/ashwaryy/roundtable/commit/3c0c285d6ce487624f654444fd672c43f9a13721))
* discussion mistakenly worded as thread ([43824d9](https://github.com/ashwaryy/roundtable/commit/43824d9240f750b5939db89e3200f8314a76094f))
* force counter repair during integrity acknowledgment ([8bf3d5b](https://github.com/ashwaryy/roundtable/commit/8bf3d5b1d7e8c3c250613730258105762a532323))
* handle Codex trust prompts and lock comment asks in auto mode ([d0f04db](https://github.com/ashwaryy/roundtable/commit/d0f04db8b7a618de82a8c0d4017dd82a192188c7))
* harden backend performance edge cases ([7354259](https://github.com/ashwaryy/roundtable/commit/7354259c842e61ff4a048a5feb54910c0c0d10df))
* keep polling for startup trust prompts until agent is ready ([807679f](https://github.com/ashwaryy/roundtable/commit/807679f8a9552c8d2769b591c42ab74c22488c03))
* remove backend read-path integrity scans ([984ec57](https://github.com/ashwaryy/roundtable/commit/984ec57ef9f453976df73b15ff79d72091fd887b))
* truncate long paths in context panel snapshot changes list ([e6d53b7](https://github.com/ashwaryy/roundtable/commit/e6d53b7e89eb8983151faf43baa7617b0cc149c9))
* workerize snapshots and cache backend lookup hot paths ([4391ece](https://github.com/ashwaryy/roundtable/commit/4391ece11d65f9ed7dc8324f597709c1d3cc913e))


### Features

* add archive thread action to thread list menu ([aeb879b](https://github.com/ashwaryy/roundtable/commit/aeb879b4dd7c563acf0ae126950adaa53a57ced9))
* add consolidation review skeleton ([6b83332](https://github.com/ashwaryy/roundtable/commit/6b83332834cace2f99b5dfa6680103ab5cc49ea7))
* implement tmux viewer to read agent session ([c52f0fc](https://github.com/ashwaryy/roundtable/commit/c52f0fc3751fef0c6a42caaa709e12d5d426894a))
* improve thread list compose UX and context rail details ([35a52a1](https://github.com/ashwaryy/roundtable/commit/35a52a12a731f70131aefce31cd26cc66cb2bc23))
* improve thread status verbiage ([ef0e8e7](https://github.com/ashwaryy/roundtable/commit/ef0e8e7c037452674bb5d271b8535f5b174554e4))
* show agent working status when side rail is collapsed ([864c86d](https://github.com/ashwaryy/roundtable/commit/864c86dc2f4d27c72995a2c827455dff1a56e442))

# [1.1.0](https://github.com/ashwaryy/roundtable/compare/v1.0.0...v1.1.0) (2026-05-26)


### Bug Fixes

* make the new-thread agent picker styling consistent ([12ca689](https://github.com/ashwaryy/roundtable/commit/12ca6891e3b040769cef2171b1a8a584084fc987))
* require stable startup trust prompt before sending keys ([44350a9](https://github.com/ashwaryy/roundtable/commit/44350a903ac3ce2ed45af52d6e27813f99dc4689))
* revalidate index.html so rebuilt bundles load without hard refresh ([afd0d77](https://github.com/ashwaryy/roundtable/commit/afd0d772332762eda8ede13afedfc3cbcd18af6a))
* show agent action feedback instantly from mutation results ([6857696](https://github.com/ashwaryy/roundtable/commit/6857696ef02ec9492a92b74de9b8f1264d0ff64f))


### Features

* add production build and static app serving ([832ef91](https://github.com/ashwaryy/roundtable/commit/832ef911b149a0459f14dbeff2aa465a357e46fd))
* breathe an agent's rail card while it works a turn ([8b92b88](https://github.com/ashwaryy/roundtable/commit/8b92b887ff0e1f152c3da1eda37048fe8ef31e2a))
* unify app headers and integrate brand assets ([723a772](https://github.com/ashwaryy/roundtable/commit/723a7725d5cdafbe2cd5f593683bca0c1c1f531a))

# 1.0.0 (2026-05-26)


### Bug Fixes

* block room actions on archived threads ([dc54441](https://github.com/ashwaryy/roundtable/commit/dc54441657cacd008d8a6fbd16931f119a2518f5))
* center composer with collapsed rail ([446e852](https://github.com/ashwaryy/roundtable/commit/446e852ca381cf72d9828757f8683c9b5d3dddec))
* disable direct agent asks in auto mode ([42e5923](https://github.com/ashwaryy/roundtable/commit/42e5923d948fef5b64c640f7995a676c357736fd))
* harden startup recovery ([528cb46](https://github.com/ashwaryy/roundtable/commit/528cb467cfc51187b00502a6d096272c676e053a))
* improve thread loading states ([2726872](https://github.com/ashwaryy/roundtable/commit/2726872a6fcdce56fa4bffbd54bcdeed0e49827b))
* new comment notification pill not displaying ([a639b9b](https://github.com/ashwaryy/roundtable/commit/a639b9bd38c1154f950a7b6132044a00d726a5c3))
* prevent unattended permission stalls ([9ef4362](https://github.com/ashwaryy/roundtable/commit/9ef436236d0c5d1bf5a8719ef18e57ada7676361))
* render markdown body spacing correctly ([3259c39](https://github.com/ashwaryy/roundtable/commit/3259c3985a0f4e78034631bbc1db6aa182c3c46a))
* show accepted consolidation requests ([f211a69](https://github.com/ashwaryy/roundtable/commit/f211a6941fb9e54346f6bfb4e8339b44cbc54d33))
* stabilize startup trust prompts ([0936836](https://github.com/ashwaryy/roundtable/commit/0936836d986b77254df4e8b96a4a6552224d1cf1))
* Use numeric Codex hook trust selection ([30eb9c0](https://github.com/ashwaryy/roundtable/commit/30eb9c08edd26f47558134e0d5f54e6c2e30b6cf))


### Features

* add agent catalog and room rosters ([0abc60f](https://github.com/ashwaryy/roundtable/commit/0abc60f5d3c20bfc03f83360f81441174d7621a7))
* add agent room MVP ([1d5ef1c](https://github.com/ashwaryy/roundtable/commit/1d5ef1c1b6ed8810bc776450220cd872a87cea73))
* add agent turn execution ([b000463](https://github.com/ashwaryy/roundtable/commit/b0004635a6f4935ac2991ed822b270808c47af84))
* add automatic discussion flow ([c5779c5](https://github.com/ashwaryy/roundtable/commit/c5779c55401dbc206ab36af968d8e8c92ed52711))
* add canonical state layer ([75b0b09](https://github.com/ashwaryy/roundtable/commit/75b0b09c9bcb876392a0a555df2a675b84fffda4))
* add comment deletion controls ([8648d93](https://github.com/ashwaryy/roundtable/commit/8648d937141ae945877de9c0f6eac71c6cbba9b7))
* add consolidation flow ([ede34d0](https://github.com/ashwaryy/roundtable/commit/ede34d047028d86c9061fb8ed052d9f3f4cc2b10))
* add discussion agent controls ([59ad7c1](https://github.com/ashwaryy/roundtable/commit/59ad7c1426f2371651066eecdad7ede6f7d36d31))
* add guard against proposal/review turn kinds ([fdb4ce4](https://github.com/ashwaryy/roundtable/commit/fdb4ce477a02a9852a3ac05e9f32b17cb4140e1e))
* add per-thread agent permissions ([40fa88d](https://github.com/ashwaryy/roundtable/commit/40fa88dbd1fc6df89ab1fc6a30dcdcc4111b1304))
* add semantic-release workflow and app version reporting ([b12c42b](https://github.com/ashwaryy/roundtable/commit/b12c42b2db6e3e3ff61fe7e0458cdadb74960183))
* Add stop and exit controls for auto mode ([833c55d](https://github.com/ashwaryy/roundtable/commit/833c55d88223181518755b982ceff2c39a6da070))
* add system prompt inventory page ([3f2455b](https://github.com/ashwaryy/roundtable/commit/3f2455b12925615d33025932fbf1f26823ac1755))
* add thread context attachments ([6673970](https://github.com/ashwaryy/roundtable/commit/66739706e32dc96f4ce5d07db2f121a90e470a98))
* add thread deletion ([510afea](https://github.com/ashwaryy/roundtable/commit/510afea875f99db020e1852653161c229b501268))
* allow multiple queued discussions ([b25d52c](https://github.com/ashwaryy/roundtable/commit/b25d52c3980974b6aaa693603a62ab375e86a5c9))
* format comments with timestamps and markdown ([ed0c1e3](https://github.com/ashwaryy/roundtable/commit/ed0c1e39734c8ebe8b89221c459fe8c600657f3f))
* handle Codex hook review prompts ([08f96d9](https://github.com/ashwaryy/roundtable/commit/08f96d9633821a0be39fa193cea6910fc1265a52))
* implement design mockup refresh ([98900a7](https://github.com/ashwaryy/roundtable/commit/98900a76220ac959b43d16d17cddaa7f1d01d5fd))
* implement local thread app ([eb2286a](https://github.com/ashwaryy/roundtable/commit/eb2286ac9a7f63e8f701aa04c62cc7f344418260))
* improve agent configuration dialogs ([fe94bf9](https://github.com/ashwaryy/roundtable/commit/fe94bf96fc208716c5fb0e1795060f3cf5349f18))
* improve consolidation outcome UX ([58081f0](https://github.com/ashwaryy/roundtable/commit/58081f078abf08046f0fce70c091aaf4fa29f370))
* improve saved output thread UI ([67a8004](https://github.com/ashwaryy/roundtable/commit/67a80042df96d59075b15acec8ca40badb243c5b))
* launch terminals for room sessions ([e7dfe27](https://github.com/ashwaryy/roundtable/commit/e7dfe2706e30322bacfda87e186c48bc881a79e9))
* model backend status in the UI ([2c96a42](https://github.com/ashwaryy/roundtable/commit/2c96a427f1a273db966f02409c11915a8104ae70))
* redesign thread main view ([9d43cfd](https://github.com/ashwaryy/roundtable/commit/9d43cfdaf9b6bd4e7f9939c19262405e488c2f11))
* refine agent suggestion flow ([bcca27e](https://github.com/ashwaryy/roundtable/commit/bcca27e40dc698e5632ddf0286b42186eaa0f4ef))
* route agent turns through prompt files ([a79701b](https://github.com/ashwaryy/roundtable/commit/a79701b6dc4f26afc07ec44136e9191d793dca11))
* surface agent permission prompts ([f011711](https://github.com/ashwaryy/roundtable/commit/f011711f8570a4d317e5e021cbbc9ee5df41cd83))
* Tighten the auto action row UI ([fd5a2ac](https://github.com/ashwaryy/roundtable/commit/fd5a2ac0b034de5bfbb74d936e508120c3b5056c))
* Updated the open-thread buttons to Consolidate and Finish & consolidate. Closed/archived threads still use the outcome wording. ([c150e98](https://github.com/ashwaryy/roundtable/commit/c150e98544ceb20e057abda9c78f217895753d22))


### Performance Improvements

* optimize thread read and refresh paths ([0b904a5](https://github.com/ashwaryy/roundtable/commit/0b904a5c0c53de158c2feaf0b1ea5709da4bacb2))
