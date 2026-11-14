/** Підміна `lib/api/simRuntimeEntry.tsx` у збірці `http`: «сервера» імітації немає. */
export function SimRuntime(props: { only?: readonly string[] }): null {
  void props;
  return null;
}
