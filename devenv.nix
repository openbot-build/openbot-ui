{ pkgs, multiverse, ... }:
{
  devenv.warnOnNewVersion = false;
  packages = with pkgs; [ git corepack ];
  languages.javascript = {
    enable = true;
    lsp.enable = false;
    package = multiverse.nodejs_26."26.12.1";
  };
}
