const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");

module.exports = (env, argv) => ({
  entry: "./src/main.ts",
  output: {
    filename: "main.js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },
  devtool: argv.mode === "production" ? false : "inline-source-map",
  module: {
    rules: [
      {
        test: /\.wgsl$/i,
        type: "asset/source",
      },
      {
        test: /\.(png|webp)$/i,
        type: "asset/resource",
      },
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    static: "./dist",
    port: 3002,
  },
});
