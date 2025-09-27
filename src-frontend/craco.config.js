const Critters = require('critters-webpack-plugin');

module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            webpackConfig.devtool = 'source-map'; // always enable source maps
            return webpackConfig;
        },
        plugins: {
            add: [
                new Critters({
                    // Critters options
                    preload: 'swap', // or 'body'
                    preloadFonts: true,
                    fonts: true,
                    noscriptFallback: true
                })
            ]
        }
    }
};