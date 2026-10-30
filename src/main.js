import {
	createSSRApp
} from "vue";
import App from "./App.vue";
import zpMixins from "./uni_modules/zp-mixins/index.js";
export function createApp() {
	const app = createSSRApp(App);
	app.mixin(zpMixins);
	return {
		app,
	};
}
